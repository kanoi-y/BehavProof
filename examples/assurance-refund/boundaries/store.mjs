import {readFileSync,writeFileSync}from'node:fs';
export function read(input,deps){return JSON.parse(readFileSync(deps.storePath,'utf8'));}
export function snapshot(targets,deps){return read(null,deps);}
export function perform(event,deps){writeFileSync(deps.storePath,JSON.stringify(event.input));return event.input;}
