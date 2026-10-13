# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately: the repository's **Security** tab → **Report a vulnerability**. Describe the problem, how to reproduce it and what an attacker could do with it. We aim to reply within a week.

## Scope

Benchmark Brawl is one static page on GitHub Pages, built by `scripts/`. It has no server and no accounts; the only thing it stores is your sound setting, in your browser. Of most interest: ways for data from Epoch AI or OpenRouter to inject script into the page, or to make the game show numbers that aren't in the source.

## Supported versions

Only the latest version on `main`.
