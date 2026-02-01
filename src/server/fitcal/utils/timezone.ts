export const DEFAULT_TIMEZONE = 'UTC';

const parseOffset = (value: string): number => {
  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) {
    return 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
};

export const getTimeZoneOffsetMinutes = (date: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const tzPart = parts.find(part => part.type === 'timeZoneName');
  if (!tzPart) {
    return 0;
  }
  return parseOffset(tzPart.value);
};

export const getUtcRangeForDate = (dateString: string, timeZone: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const utcBase = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcBase, timeZone);
  const start = new Date(utcBase.getTime() - offsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
};

export const formatDateInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value || '1970';
  const month = parts.find(part => part.type === 'month')?.value || '01';
  const day = parts.find(part => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
};
