interface Window {
  underCtrl?: {
    getConnection(): Promise<{ origin: string }>;
    setConnection(origin: string): Promise<void>;
  };
}
