const STORAGE_KEY = "bookData";

export function getBookData() {
  const data = sessionStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : {};
}

export function updateBookData(newData) {
  const current = getBookData();
  const updated = { ...current, ...newData };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function clearBookData() {
  sessionStorage.removeItem(STORAGE_KEY);
}
