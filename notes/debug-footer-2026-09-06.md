# Debug diagnostics below the player

Moved the existing five clock/tempo/sync diagnostic blocks from the output sidebar into a full-width section below the main operating area. Renamed its panel to 再生情報（デバッグ）. Existing IDs, values, tooltips and saved folding choices remain intact; it still defaults collapsed. Expanded cards wrap to available width.

Core desktop controls keep their original positions and remain within 1366×768. The debug footer can extend the page below the first viewport. Updated the existing layout verifier to check main controls and the footer's lower position separately.

Validation: TypeScript check, Cloudflare build, whitespace check, existing layout/playback and desktop/touch tooltip browser scripts. The 30-track fixture remained playable with mute/solo and folding. Public HTML, JS and CSS matched the build; production footer placement, collapsed default, all five values, tooltip and folding were verified.

Deployment: `a6db433b-5e8c-46ff-8160-032a08a72b89`, https://madrv-player.madrv-player-web.workers.dev/.
