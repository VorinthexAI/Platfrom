# Vorinthex Email Layout

`default-email-layout.html` is the shared base for transactional email.

Email layouts use literal inline hex values from `../DESIGN_SYSTEM.md`
(obsidian/chrome palette) instead of CSS variables: most email clients strip
external stylesheets and support `var()` unreliably, so token indirection
would silently break. Do not define per-layout token variables inside email
layouts; keep values inline and in sync with the design system.

## Placeholders

- `{{subject}}`
- `{{preheader}}`
- `{{label}}`
- `{{eyebrow}}`
- `{{headline}}`
- `{{body_html}}`
- `{{action_url}}`
- `{{action_label}}`
- `{{supporting_html}}`
- `{{footer_html}}`

Use the same template for sign-in links, waitlist messages, TOTP setup notices,
invitations, receipts, and operational alerts by changing the placeholder values.

Keep critical CSS inline where possible. Many email clients strip external
stylesheets and only partially support `<style>` blocks, so inline declarations
should include fallback values.
