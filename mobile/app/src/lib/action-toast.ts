/** Single-resource actions name the resource; multi-resource actions include a count. */
export function actionToast(count: number, singular: string, plural: string, action: string) {
  return `${count === 1 ? singular : `${count} ${plural}`} ${action}`;
}

export function countedToastNoun(count: number, singular: string, plural: string) {
  return count === 1 ? singular : `${count} ${plural}`;
}
