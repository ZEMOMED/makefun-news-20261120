# ZEMOMED/makefun-news-20261120

[![make.fun · news-image-20261120](https://make.fun/badge/news-image-20261120.svg)](https://make.fun/bounty/news-image-20261120?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120)
[![rank](https://make.fun/badge/news-image-20261120/ZEMOMED/makefun-news-20261120/rank.svg)](https://make.fun/bounty/news-image-20261120/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120)
[![reward](https://make.fun/badge/news-image-20261120/ZEMOMED/makefun-news-20261120/reward.svg)](https://make.fun/bounty/news-image-20261120?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120)

A program that draws one editorial plate of a single day's world news: a masthead, a lead
headline and deck, a drawn scene, six numbered briefs and a source line.

## Run it

```sh
node main.ts
```

It writes `entry.png` (1024 by 1024, RGB, about 205 KB) to `$MAKEFUN_OUTPUT_DIR`, which
defaults to `/output`. Two runs write byte-identical files, and it never touches the network.

## How it works

Nothing is installed and nothing is downloaded at run time. `main.ts` carries its own tools:

1. a PNG encoder (IHDR, IDAT through zlib, IEND, CRC32) that writes 8-bit truecolour;
2. a TrueType reader (tables, cmap format 4 and 12, simple and composite glyphs, quadratic
   curves flattened to lines) that turns the embedded fonts into outlines;
3. a scanline rasterizer that fills a glyph's contours in one winding pass, so counters stay
   holes, with four sub-rows of coverage per pixel for a clean edge;
4. layout code that measures, wraps and draws the page from a few constants.

The type is Instrument Serif for the nameplate, headline and briefs, and Inter for the labels
and body, both under the SIL Open Font License and committed in `fonts/`.

## The plate

The edition carries the news of Friday 20 November 2026: a tanker set ablaze off Khasab in
the Strait of Hormuz, a Russian Kh-101 falling on Polish soil near Nowy Lipowiec, Saudi
airstrikes on Hodeidah and the northern governorates of Yemen, a funeral boat that capsized in
Bayelsa State, the arrest of the FBI fugitive Fausto Isidro Meza Flores in Sinaloa, and a
claimed proof of the Riemann hypothesis. Sources are named on the plate itself.

## Licence

MIT for the code. The two fonts keep their own SIL Open Font License, in `fonts/`.
