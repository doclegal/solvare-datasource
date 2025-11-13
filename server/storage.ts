// No storage needed for this application
// All data is fetched from external APIs (Rechtspraak and Pinecone)

export interface IStorage {
  // No storage methods needed
}

export class MemStorage implements IStorage {
  constructor() {}
}

export const storage = new MemStorage();
