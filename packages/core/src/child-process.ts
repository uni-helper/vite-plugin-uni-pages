import type { SpawnOptionsWithoutStdio } from 'node:child_process'
import { spawn } from 'node:child_process'
import process from 'node:process'

export function runProcess(command: string, args: string[] = [], options?: SpawnOptionsWithoutStdio) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
      },
      ...options,
    })
    const output = [] as string[]
    child.stdout.on('data', chunk => output.push(chunk))
    child.on('close', () => resolve(output.join('').trim()))
    child.on('error', error => reject(error))
  })
}
