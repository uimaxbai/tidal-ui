#!/usr/bin/env python3
"""
Author: Michal Szymanski <misiektoja-github@rm-rf.ninja>
v1.2

Automatic extractor for secret keys used for TOTP generation in Spotify Web Player JavaScript bundles
https://github.com/misiektoja/spotify_monitor#debugging-tools

Python pip3 requirements:

playwright

Install:

pip install playwright
playwright install

---------------

Change log:

v1.2 (12 Oct 25):
- Added CLI output modes (--secret, --secretbytes and --secretdict CLI flags, see -h for help)
- Added --all mode writing all secret formats to files (secrets.json, secretBytes.json, secretDict.json) (thx @tomballgithub)

v1.1 (12 Jul 25):
- Added JSON array output for plain secrets and secret bytes

v1.0 (09 Jul 25):
- Initial proof-of-concept, confirmed to extract v10, v11 and v12 secrets
"""


import asyncio
import re
from datetime import datetime
import json
from typing import List, Dict, Any
from playwright.async_api import async_playwright
import argparse
import sys


BUNDLE_RE = re.compile(r"""(?x)(?:vendor~web-player|encore~web-player|web-player)\.[0-9a-f]{4,}\.(?:js|mjs)""")
TIMEOUT = 45000  # 45s
VERBOSE = True

OUTPUT_FILES = {
    'plain_json': 'secrets.json',
    'bytes_json_array': 'secretBytes.json',
    'bytes_json_dict': 'secretDict.json',
}


def _inline_int_array(nums):
    return '[ ' + ', '.join(str(n) for n in nums) + ' ]'


def _write_secretbytes_compact(fp, items):
    fp.write('[\n')
    last = len(items) - 1
    for i, itm in enumerate(items):
        comma = ',' if i < last else ''
        fp.write(f'  {{ "version": {itm["version"]}, "secret": {_inline_int_array(itm["secret"])} }}{comma}\n')
    fp.write(']\n')


def _write_secretdict_compact(fp, mapping):
    keys = sorted(mapping.keys(), key=lambda k: int(k))
    fp.write('{\n')
    for i, v in enumerate(keys):
        comma = ',' if i < len(keys) - 1 else ''
        fp.write(f'  "{v}": {_inline_int_array(mapping[v])}{comma}\n')
    fp.write('}\n')


def log(m):
    if VERBOSE:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}")


def summarise(caps: List[Dict[str, Any]], mode=None):
    real = {}

    for cap in caps:
        sec = cap.get('secret')
        if not isinstance(sec, str):
            continue
        ver = cap.get('version') or (isinstance(cap.get('obj'), dict) and cap['obj'].get('version'))
        if ver is None:
            continue
        real[str(ver)] = sec

    if not real:
        log('No real secrets with version.')
        return

    sorted_items = sorted(real.items(), key=lambda kv: int(kv[0]))
    formatted_data = [{"version": int(v), "secret": s} for v, s in sorted_items]
    secret_bytes = [{"version": int(v), "secret": [ord(c) for c in s]} for v, s in sorted_items]
    secret_dict = {v: [ord(c) for c in s] for v, s in sorted_items}

    if mode is None:
        print("\n--- List of extracted secrets ---\n")
        for v, s in sorted(real.items(), key=lambda kv: int(kv[0])):
            print(f"v{v}: '{s}'")

        print("\n--- Plain secrets (JSON array) ---\n")
        print(json.dumps(formatted_data, indent=2))

        print("\n--- Secret bytes (JSON array) ---\n")
        print('[')
        for idx, itm in enumerate(secret_bytes):
            comma = ',' if idx < len(secret_bytes) - 1 else ''
            print('  {')
            print(f'    "version": {itm["version"]},')
            print(f'    "secret": {_inline_int_array(itm["secret"])}')
            print(f'  }}{comma}')
        print(']')

        print("\n--- Secret bytes (JSON object/dict): version -> byte list mapping ---\n")
        print('{')
        last = len(real) - 1
        for idx, (v, s) in enumerate(sorted(real.items(), key=lambda kv: int(kv[0]))):
            arr = [ord(c) for c in s]
            comma = ',' if idx < last else ''
            print(f'  "{v}": {_inline_int_array(arr)}{comma}')
        print('}')

    elif mode == 'secret':
        print(json.dumps(formatted_data, indent=2))

    elif mode == 'secretbytes':
        print('[')
        for idx, itm in enumerate(secret_bytes):
            comma = ',' if idx < len(secret_bytes) - 1 else ''
            print(f'  {{ "version": {itm["version"]}, "secret": {_inline_int_array(itm["secret"])} }}{comma}')
        print(']')

    elif mode == 'secretdict':
        print('{')
        last = len(real) - 1
        for idx, (v, s) in enumerate(sorted(real.items(), key=lambda kv: int(kv[0]))):
            arr = [ord(c) for c in s]
            comma = ',' if idx < last else ''
            print(f'  "{v}": {_inline_int_array(arr)}{comma}')
        print('}')

    elif mode == 'all':
        try:
            with open(OUTPUT_FILES['plain_json'], 'w') as f:
                json.dump(formatted_data, f, indent=2)
                f.write('\n')
            with open(OUTPUT_FILES['bytes_json_array'], 'w') as f:
                _write_secretbytes_compact(f, secret_bytes)
            with open(OUTPUT_FILES['bytes_json_dict'], 'w') as f:
                _write_secretdict_compact(f, secret_dict)
            if VERBOSE:
                print(f"[+] Wrote plain secrets to {OUTPUT_FILES['plain_json']}")
                print(f"[+] Wrote secret bytes array to {OUTPUT_FILES['bytes_json_array']}")
                print(f"[+] Wrote secret bytes dict to {OUTPUT_FILES['bytes_json_dict']}")
        except Exception as e:
            print(f"Error writing output files: {e}", file=sys.stderr)


async def grab_live():
    hook = """(()=>{if(globalThis.__secretHookInstalled)return;globalThis.__secretHookInstalled=true;globalThis.__captures=[];
Object.defineProperty(Object.prototype,'secret',{configurable:true,set:function(v){try{__captures.push({secret:v,version:this.version,obj:this});}catch(e){}
Object.defineProperty(this,'secret',{value:v,writable:true,configurable:true,enumerable:true});}});})();"""

    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context()
        await ctx.add_init_script(hook)
        pg = await ctx.new_page()
        pg.on('response', lambda resp: BUNDLE_RE.fullmatch(resp.url.split('/')[-1]) and log(f"↓ {resp.url.split('/')[-1]} ({resp.status})"))
        log('→ opening open.spotify.com ...')
        await pg.goto('https://open.spotify.com', timeout=TIMEOUT)
        await pg.wait_for_load_state('networkidle', timeout=TIMEOUT)
        await pg.wait_for_timeout(3000)
        caps = await pg.evaluate('__captures')

        if caps:
            for c in caps:
                if isinstance(c.get('secret'), str) and c.get('version') is not None:
                    log(f"✔ secret({c.get('version')}) → {c.get('secret')}")

        await b.close()
        return caps or []


def main():
    parser = argparse.ArgumentParser(description='Extract Spotify web-player TOTP secrets')
    parser.add_argument('--secret', action='store_true', help='Output plain secrets JSON only')
    parser.add_argument('--secretbytes', action='store_true', help='Output secret-bytes JSON only')
    parser.add_argument('--secretdict', action='store_true', help='Output version->byte-list dict JSON only')
    parser.add_argument('--all', action='store_true', help='Write plain, bytes array and bytes dict JSON files')
    args = parser.parse_args()

    mode = None
    if args.secret:
        mode = 'secret'
    elif args.secretbytes:
        mode = 'secretbytes'
    elif args.secretdict:
        mode = 'secretdict'
    elif args.all:
        mode = 'all'

    global VERBOSE
    if mode and mode != 'all':
        VERBOSE = False
    elif mode == 'all':
        VERBOSE = True

    try:
        caps = asyncio.run(grab_live())
        summarise(caps, mode)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()