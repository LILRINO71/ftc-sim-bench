# FTC Sim Bench

**Drop in any FTC robot's STEP CAD and any OpMode. The bench resolves the assembly, interprets your code at 50 Hz, and lets you drive the result with a virtual gamepad — then tells you what won't work before you find out on the field.**

**Live:** https://lilrino71.github.io/ftc-sim-bench/ — runs entirely in the browser; nothing is uploaded anywhere.

---

## What it catches

These are real findings from real team code, not contrived examples:

| Finding | Why it matters |
|---|---|
| **Servo can't hold the arm** — `0.42 N·m usable vs 0.48 N·m needed` | Lever arm measured from the CAD, servo spec from the part number or your code comment, worst case where the arm sweeps through horizontal. The sim reproduces it: press the button and the arm jams partway. |
| **Code and CAD disagree about which servo is which** | The comment says *torque servo*; the STEP assembly has the *speed* variant bolted on. |
| **`sleep()` inside the TeleOp loop** | A LinearOpMode is one thread. `sleep(450)` freezes the drivetrain and every PID loop for ~22 cycles. |
| **A button wired to an empty block** | `if (gamepad2.y) { }` reads like an unfinished binding. |
| **Mirrored pair set the same way round** | Left/right servos that both — or neither — call `setDirection(REVERSE)` fight each other. |
| **Stick sign** | Pushing forward reports a *negative* `left_stick_y`; missing the minus drives the robot backwards. |

## How it works

The idea that makes it work across thousands of different robots: **separate what the files state from what has to be guessed.**

**Facts — parsed, never guessed.**
- **STEP (ISO 10303-21)**: the entity graph, product tree, units, and assembly transforms. Part geometry is usually stored in the part's own coordinates and placed by the assembly, so the bench walks the occurrence tree and composes transforms instead of drawing raw points (which piles most of a robot on the origin).
- **Java OpMode**: parsed into a statement tree — assignments, `if`/`else`, device calls — with a real expression grammar (precedence, ternary, booleans, `Math.*`, `Range.clip`). It is **interpreted**, not pattern-matched, so rising-edge latches, stick mixing, field-centric drive and PID all behave the way they do on the robot.

**Guesses — seeded automatically, owned by you.**
Which subassembly is a mechanism, what kind of joint it is, what carries what, which device maps where. None of that is in a STEP file — Onshape exports no kinematics — so no amount of tuning makes it reliable. The bench makes a first draft, marks every guess, and hands you the **rig**: an editable, portable document (~1 kB of JSON) you can commit next to your OpMode and reuse next season.

**Simulation.** Servos slew at their rated speed and stall when the torque model says the joint can't lift. Motors integrate an encoder from commanded power, so `getCurrentPosition()` feeds your own `PIDController` back. A detected drivetrain (tank or mecanum, any common naming style) drives the robot around the field.

## Run it

Open `docs/index.html` in a browser, or use the live link. To work on it:

```bash
npm run build     # src/ → dist/ftc-sim-bench.html, dist/preview.html, docs/index.html
npm test          # node --test, no dependencies
```

Zero runtime dependencies beyond three.js (r128, from cdnjs) and Google Fonts.

## Project layout

```
src/
  hardware.js   actuator database, part-number recognition, spec precedence (code vs CAD)
  samples.js    built-in example robot and OpModes
  step.js       STEP parser, assembly transforms, mechanism detection, the kinematic rig
  expr.js       expression grammar and evaluator
  java.js       OpMode → statement tree, bindings, travel ranges
  mapping.js    device ↔ mechanism matching, drivetrain detection
  analyze.js    findings
  sim.js        50 Hz interpreter: servos, encoders, PID, chassis
  view3d.js     three.js articulated view            (browser only)
  app.js        UI, gamepad, rig document            (browser only)
tests/
  engine.test.mjs        runs the real engine files in Node
  fixtures/              a hand-written STEP assembly and a competition-style OpMode
tools/build.mjs          single-file bundle for Pages and for sharing
```

## Honest limits

- **Torque figures are estimates**: published stall torque, a lever measured from CAD, and a payload you set. They tell you which joint to go measure, not a substitute for measuring it.
- **Don't tune PID gains here.** The motor model has no inertia, gravity load or friction; use it to check *which way* a target drives a mechanism.
- **Robot Controller config names** can't be verified from CAD — they must still match your Driver Station configuration.
- The Java interpreter covers the constructs TeleOps actually use; it does not compile arbitrary Java.

## License

MIT
