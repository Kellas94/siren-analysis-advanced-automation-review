// Display coordinates only; real schema names remain the data/binding keys.
export function columnLetter(index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Invalid column index');
  let value = index, label = '';
  do {
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}
