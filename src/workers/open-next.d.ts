declare module '*.open-next/worker.js' {
  const worker: {
    fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Response | Promise<Response>;
  };
  export default worker;
}
