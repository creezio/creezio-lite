/** Shim minimal pour typecheck kit sans peer next installé. */
declare module "next/headers" {
  export function cookies(): {
    get(name: string): { value: string } | undefined;
  };
}
