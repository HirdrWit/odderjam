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
