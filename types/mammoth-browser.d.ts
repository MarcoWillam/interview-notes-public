declare module 'mammoth/mammoth.browser.js' {
  const mammoth: {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string }>;
  };
  export default mammoth;
}
