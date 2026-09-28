#!/usr/bin/env python3
"""게임 소스에 쓰인 한글만 담은 Black Han Sans 서브셋(woff2)을 다시 받는다.

UI 문구를 바꾼 뒤 실행:  python3 tools/update-font-subset.py
(Google Fonts의 text= 서브셋 API 사용, SIL Open Font License 1.1)
"""
import glob
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'fonts', 'BlackHanSans-subset.woff2')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

chars = set()
files = glob.glob(os.path.join(ROOT, 'js', '**', '*.js'), recursive=True) + [os.path.join(ROOT, 'index.html')]
for f in files:
    for c in open(f, encoding='utf8').read():
        if '가' <= c <= '힣' or 'ㄱ' <= c <= 'ㆎ':
            chars.add(c)
text = ''.join(sorted(chars)) + '0123456789+-×!?.,:%()★ ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
url = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&text=' + urllib.parse.quote(text)
css = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})).read().decode()
font_url = re.search(r'url\((https://[^)]+)\)', css).group(1)
data = urllib.request.urlopen(urllib.request.Request(font_url, headers={'User-Agent': UA})).read()
open(OUT, 'wb').write(data)
print(f'{len(chars)} glyphs -> {OUT} ({len(data)} bytes)')
