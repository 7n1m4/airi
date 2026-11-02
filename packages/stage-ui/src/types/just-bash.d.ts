declare module 'just-bash' {
  export class Bash { constructor(...args: any[]); registerCommand(...args: any[]): any; [key: string]: any }
  export type ExecResult = any
  export type ResolvedCommandContext = any
}
