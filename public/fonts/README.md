# Bundled font assets

This directory contains **Font Awesome Free 5.13.0** assets, as identified by their embedded SVG headers:

- `fa-brands-400`: brand icons.
- `fa-regular-400`: regular icons.
- `fa-solid-900`: solid icons.

Each is present in EOT, SVG, TTF, WOFF, and WOFF2 formats. There are no `BlockchainFont` or `TechMono` files; earlier documentation describing those fonts did not match this directory.

The current first-party UI does not reference these assets. UI icons use `lucide-react`, text uses a system-font fallback stack, and math fonts come from KaTeX. Vite nevertheless copies `public/` contents into frontend builds, so these files are currently redistributed in build output.

The embedded headers identify fonts as SIL OFL 1.1, icons as CC BY 4.0, and code as MIT. See the [upstream version's license](https://github.com/FortAwesome/Font-Awesome/blob/5.13.0/LICENSE.txt). A complete standalone license notice is not included here. Before distributing the assets, include their applicable upstream notices or deliberately remove unused assets after confirming they are unnecessary. This inventory does not change or grant a license for mdReader itself.
