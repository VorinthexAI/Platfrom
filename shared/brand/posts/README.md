# Post Layouts

Post layout templates are split by post type.

- `single/` contains one-output post layouts.
- `multi/` contains slideshow/carousel layouts.

Use `../layout.css` for shared brand tokens instead of defining CSS variables per
layout. Keep each layout focused on one output format and aspect ratio.

Tokens:

- `{{title}}` sets the HTML title and canvas accessibility label.
- `{{image_url}}` sets the image source.
- `{{image_alt}}` sets the image alt text.
- `{{overlay_text}}` optionally renders text over the image. Replace it with an empty string to hide the overlay.

Current layouts:

- `single/square/default-layout.html` renders one 1080px square image.
- `single/portrait/default-layout.html` renders one 1080x1920 portrait post with a centered 1080px square image.
- `multi/square/default-layout.html` mirrors the square single-post image layout for slideshow frames.
- `multi/portrait/default-layout.html` mirrors the portrait single-post image layout for slideshow frames.
