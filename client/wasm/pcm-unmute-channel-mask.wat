;; Replacement for v12's mdx_player_set_channel_mask (function 148, export "t").
;; The v12 hash is checked by scripts/build-pcm-unmute-core.mjs before applying.
;; MXDRV skips L000c66 while masked, leaving S0016 bit 0 (pending key-on) set.
;; Cancel only that pending event on PCM channels transitioning muted -> audible.
;; Leave the sequencer cursor, timing, gate/tie flags and all OPM channels intact.
(func (param $mask i32) (result i32)
  (local $context i32) (local $unmuted i32) (local $track i32) (local $flags i32)
  (if (result i32) (i32.load8_u (i32.const 137220))
    (then
      (local.set $context (i32.load (i32.const 137224)))
      (local.set $unmuted
        (i32.and
          (i32.load16_u offset=1538 (local.get $context))
          (i32.xor (local.get $mask) (i32.const -1))))
      (local.set $track (i32.const 8))
      (loop $pcm
        (if (i32.and (local.get $unmuted) (i32.shl (i32.const 1) (local.get $track)))
          (then
            ;; v12 wasm32 MXWORK_CH: base context+64, stride 88, S0016 offset 26.
            (local.set $flags
              (i32.add (local.get $context)
                (i32.add (i32.const 90) (i32.mul (local.get $track) (i32.const 88)))))
            (i32.store8 (local.get $flags)
              (i32.and (i32.load8_u (local.get $flags)) (i32.const 254)))))
        (local.set $track (i32.add (local.get $track) (i32.const 1)))
        (br_if $pcm (i32.lt_u (local.get $track) (i32.const 16))))
      (i32.store16 offset=1538 (local.get $context) (local.get $mask))
      (i32.const 0))
    (else (i32.const -1))))
