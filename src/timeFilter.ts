import Decimal from 'decimal.js';
import { DateTime, IANAZone } from 'luxon';

const EXACT = Decimal.clone({ precision: 256 });
const units = { fs: '1', ps: '1000', ns: '1000000', us: '1000000000', ms: '1000000000000', s: '1000000000000000' };
export type TimeUnit = keyof typeof units;
export type TimeProfile = {
    kind: 'cycles' | 'simulation' | 'wall';
    pattern: string;
    unit?: TimeUnit;
    scale?: string;
    format?: string;
    zone?: string;
    start?: string;
    end?: string;
    untimed: 'inherit' | 'exclude';
};
export type TimeSummary = {
    timed: number; invalid: number; untimed: number; resets: number;
    first?: string; last?: string; minimum?: string; maximum?: string;
    samples: string[];
};

export const cyclePattern = '\\(\\s*cycle\\s*:\\s*(\\d+)\\s*\\)';
export const uvmPattern = '@\\s*(\\d+(?:\\.\\d+)?)\\s*(fs|ps|ns|us|ms|s)?(?=\\s|:|$)';
export const isoPattern = '(\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)';

function exactNumber(value: string): Decimal {
    if (!/^\d+(?:\.\d+)?$/.test(value) || value.replace('.', '').length > 80) {
        throw new Error('Expected a non-negative decimal with at most 80 digits');
    }
    return new EXACT(value);
}

export function normalizeTime(value: string, profile: TimeProfile, capturedUnit?: string): Decimal {
    if (profile.kind === 'cycles') {
        if (!/^\d+$/.test(value.trim())) {
            throw new Error('Cycle bounds and captures must be non-negative whole counts');
        }
        return exactNumber(value.trim());
    }
    if (profile.kind === 'simulation') {
        const parts = /^(\d+(?:\.\d+)?)\s*(fs|ps|ns|us|ms|s)?$/i.exec(value.trim());
        if (!parts) {
            throw new Error('Expected simulation time such as 1250, 1.25 us, or 500 ns');
        }
        const explicitUnit = (capturedUnit || parts[2])?.toLowerCase();
        const unit = (explicitUnit || profile.unit) as TimeUnit;
        if (!Object.prototype.hasOwnProperty.call(units, unit)) {
            throw new Error('Choose the unit for timestamps that omit a unit');
        }
        const scale = explicitUnit ? new EXACT(1) : exactNumber(profile.scale || '1');
        if (scale.lte(0)) {
            throw new Error('Simulation scale must be greater than zero');
        }
        return exactNumber(parts[1]).times(units[unit]).times(scale);
    }
    const zone = profile.zone || 'UTC';
    if (zone !== 'UTC' && !IANAZone.isValidZone(zone)) {
        throw new Error('Use UTC or an IANA timezone such as Asia/Kolkata');
    }
    if (/\.\d{4,}/.test(value)) {
        throw new Error('Wall-clock profiles support millisecond precision; use a numeric profile for finer clocks');
    }
    let parsed: DateTime;
    if (!profile.format || profile.format === 'ISO') {
        if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)) {
            throw new Error('ISO timestamps require a full date and time');
        }
        parsed = DateTime.fromISO(value.replace(' ', 'T'), { zone, setZone: true });
        if (parsed.isValid && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
            && parsed.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== value.replace(' ', 'T').slice(0, 19)) {
            throw new Error('Timestamp falls in a timezone clock gap');
        }
    } else {
        if (!/y/.test(profile.format) || !/[ML]/.test(profile.format) || !/d/.test(profile.format)) {
            throw new Error('Custom date formats must include year, month, and day; time-only logs need a numeric clock profile');
        }
        parsed = DateTime.fromFormat(value, profile.format, { zone, setZone: true });
        if (parsed.isValid && parsed.toFormat(profile.format) !== value) {
            throw new Error('Timestamp does not exactly match the format or falls in a timezone clock gap');
        }
    }
    if (!parsed.isValid) {
        throw new Error(`Invalid timestamp: ${parsed.invalidExplanation || value}`);
    }
    if (parsed.getPossibleOffsets().length > 1) {
        throw new Error('Ambiguous daylight-saving timestamp; include an explicit UTC offset');
    }
    return new EXACT(parsed.toMillis());
}

export function validateTimeProfile(profile: TimeProfile): void {
    if (!profile || !['cycles', 'simulation', 'wall'].includes(profile.kind) || !['inherit', 'exclude'].includes(profile.untimed)) {
        throw new Error('Invalid time profile type or continuation policy');
    }
    if (typeof profile.pattern !== 'string' || !profile.pattern || profile.pattern.length > 2000) {
        throw new Error('Provide a capture regex of at most 2000 characters');
    }
    new RegExp(profile.pattern, 'i');
    if (profile.kind === 'simulation') {
        normalizeTime('0', profile);
    }
    if (profile.kind === 'wall') {
        if (profile.zone !== 'UTC' && !IANAZone.isValidZone(profile.zone || 'UTC')) {
            throw new Error('Invalid timezone');
        }
        if (profile.format && profile.format !== 'ISO' && (!/y/.test(profile.format) || !/[ML]/.test(profile.format) || !/d/.test(profile.format))) {
            throw new Error('Custom formats require a full date');
        }
    }
    const start = profile.start ? normalizeTime(profile.start, profile) : undefined;
    const end = profile.end ? normalizeTime(profile.end, profile) : undefined;
    if (start && end && start.gt(end)) {
        throw new Error('The start must be less than or equal to the end');
    }
}

export function evaluateTimeRange(lines: string[], profile: TimeProfile): { allowed: boolean[]; summary: TimeSummary } {
    validateTimeProfile(profile);
    const regex = new RegExp(profile.pattern, 'i');
    const start = profile.start ? normalizeTime(profile.start, profile) : undefined;
    const end = profile.end ? normalizeTime(profile.end, profile) : undefined;
    const summary: TimeSummary = { timed: 0, invalid: 0, untimed: 0, resets: 0, samples: [] };
    let previous: Decimal | undefined;
    let inherited = false;
    let minimum: Decimal | undefined;
    let maximum: Decimal | undefined;
    const allowed = lines.map((line, index) => {
        const match = regex.exec(line);
        if (!match) {
            summary.untimed++;
            return profile.untimed === 'inherit' && inherited;
        }
        try {
            if (typeof match[1] !== 'string') {
                throw new Error('Capture group 1 must contain the timestamp');
            }
            const value = normalizeTime(match[1], profile, profile.kind === 'simulation' ? match[2] : undefined);
            const label = profile.kind === 'wall' ? DateTime.fromMillis(value.toNumber(), { zone: 'UTC' }).toISO()!
                : `${value.toFixed()} ${profile.kind === 'cycles' ? 'cycles' : 'fs'}`;
            if (previous && value.lt(previous)) {
                summary.resets++;
            }
            previous = value;
            summary.timed++;
            summary.first = summary.first || label;
            summary.last = label;
            if (!minimum || value.lt(minimum)) {
                minimum = value;
                summary.minimum = label;
            }
            if (!maximum || value.gt(maximum)) {
                maximum = value;
                summary.maximum = label;
            }
            if (summary.samples.length < 5) {
                summary.samples.push(`${index + 1}: ${match[1]} -> ${label}`);
            }
            inherited = (!start || value.gte(start)) && (!end || value.lte(end));
            return inherited;
        } catch {
            inherited = false;
            previous = undefined;
            summary.invalid++;
            return false;
        }
    });
    return { allowed, summary };
}