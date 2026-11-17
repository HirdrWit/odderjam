import {badgesFor} from './bettable.js';

/** Form fields that are not plain text inputs; new rules start with Bettable only on. */
export const BLANK_RULE_FIELDS = {bettable: true};

/** Help text under the Bettable only checkbox on the Alerts form. */
export const BETTABLE_HELP =
    'Skip risky prices: in-play (possibly stale), longshots, heavy favourites and edges that look too good to be true. ' +
    'Turn it off to be told about every edge; flagged alerts then show why they are risky.';

/**
 * @param {{data: (?{flags: (!Array<string>|undefined)}|undefined)}} item A recent alert.
 * @return {!Array<string>} Badge labels for the flags the alert fired with.
 */
export function alertFlagBadges(item) {
  return badgesFor({flags: item?.data?.flags}).map((b) => b.label);
}

/**
 * Returns why the Add-alert form cannot be submitted, or null when it is valid.
 * @param {{min_value: (string|number)}} form
 * @return {?string}
 */
export function ruleFormError(form) {
  const raw = form.min_value;
  const value = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  if (!(Number.isFinite(value) && value >= 0)) return 'Min % must be 0 or more';
  return null;
}
