export function chunkArray(array: any[], chunkSize = 2) {
  const newArray = [];
  while (array.length !== 0) {
    newArray.push(array.splice(0, chunkSize));
  }
  return newArray;
}
