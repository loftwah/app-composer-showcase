// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
export declare const calendarDatePattern = "^(?!0000)(?:[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$";
export declare function isCalendarDate(value: unknown): value is string;
export declare function calendarDateLabel(value: unknown): string | null;
export declare function validAchievementDate(value: unknown): value is string;
export declare function achievementDateLabel(value: unknown): string;
