export const getIndexedDB = (): IDBFactory | null => {
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  return null;
};
