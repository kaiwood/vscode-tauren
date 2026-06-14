import { dirname } from 'node:path';

export type KwardLaunchCommand = {
  command: string;
  args: string[];
  cwd: string;
};

export function resolveKwardLaunch(kwardPath?: string): KwardLaunchCommand {
  return {
    command: kwardPath || 'kward',
    args: ['rpc'],
    cwd: kwardPath ? dirname(kwardPath) : process.cwd()
  };
}
