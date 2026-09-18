# FTC Sim Bench

**Drop in any FTC robot's STEP CAD and any OpMode. The bench resolves the assembly, runs your code on a virtual Driver Station — INIT, START, STOP — and lets you drive the result. Then it tells you what won't work before you find out on the field.**

**Live:** https://lilrino71.github.io/ftc-sim-bench/ — runs entirely in the browser; nothing is uploaded anywhere.
One-click demos: [autonomous on the field](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-auto&start=1&view=field&right=graph) · [mecanum TeleOp](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-mecanum&start=1&view=field) · [arm + claw](https://lilrino71.github.io/ftc-sim-bench/?opmode=sample-claw)

![The bench with a TeleOp loaded and initialised, waiting for START](docs/bench.png)

---

## What it catches

Real findings from real team code:

| Finding | Why it matters |
|---|---|
| **A `hardwareMap` name isn't in the robot configuration** | Load the Robot Controller's configuration `.xml` and every name is checked exactly — including capitalisation (`"FrontRight"` ≠ `"frontRight"`) and type (a `Servo` in code configured as a continuous-rotation servo). Each of these stops the OpMode during INIT. |
| **`sleep()` inside the TeleOp loop** | A LinearOpMode is one thread. `sleep(450)` freezes the drivetrain and every PID loop for ~22 cycles. |
| **The servo can't hold the arm** — `0.42 N·m usable vs 0.48 N·m needed` | Lever measured from the CAD, servo spec from the part number or your code comment, worst case where the arm sweeps through horizontal. Press the button and the arm jams partway, just like on the robot. |
| **Code and CAD disagree about which servo is which** | The comment says *torque servo*; the STEP assembly has the *speed* variant bolted on. |
| **A button wired to an empty block**, **a mirrored pair set the same way round**, **a missing minus on `left_stick_y`** | Small things that cost a match. |
| **Lines the bench can't simulate** | Reported by line number with a reason (`follower.update()`, a `for` loop inside the loop) — never silently skipped. |

## What you can do with it

- **Driver Station flow.** Pick an OpMode, INIT runs everything before `waitForStart()`, START runs the loop, STOP drops motor power. TeleOp gets a 2:00 match clock, Autonomous 0:30.
- **Autonomous runs in order.** `sleep()` and wait loops hold the sequence while simulated time passes. `RUN_TO_POSITION`, `isBusy()`, `ElapsedTime` and `getRuntime()` behave as they do on the robot.
- **Drive it.** An on-screen gamepad (both `gamepad1` and `gamepad2`), the keyboard, or a real USB controller. Tank and mecanum drivetrains drive around a 12 ft field of foam tiles; field-centric code reads the simulated IMU.
- **Watch PID loops converge.** Encoders integrate from commanded power, so `getCurrentPosition()` feeds your own `PIDController` back. The Graph tab plots telemetry, servo positions, motor power and encoder counts.
- **Tune live.** `static` fields show up as config variables you can edit while the OpMode runs, the way FTC Dashboard exposes `@Config` fields.
- **Compare two versions** of a TeleOp control by control — the quickest way to see what changed between `teleop_v3` and `teleop_final`.
- **Own the rig.** Joint types, what carries what, pivots and hardware specs are an editable, portable ~1 kB document you can commit next to your OpMode.
- **Dark or light**, remembered between visits.

![An autonomous OpMode running on the field view with the telemetry graph open](docs/auto.png)

## How it works

The idea that makes it work across thousands of different robots: **separate what the files state from what has to be guessed.**

**Facts — parsed, never guessed.**
- **STEP (ISO 10303-21)**: entity graph, product tree, units and assembly transforms. Most exports store each part in its own coordinates and place it with the assembly, so the bench walks the occurrence tree and applies the transforms. The record splitter is string- and comment-aware and linear-time on 50 MB files.
- **Java OpMode**: parsed into a statement tree with a real expression grammar — precedence, ternaries, booleans, `Math.*`, `Range.clip`, `x++` — and **interpreted**, not pattern-matched. Rising-edge latches, stick mixing, field-centric drive and PID all behave the way they do on the robot.
- **Robot configuration `.xml`**: devices, hubs, ports and types.

**Guesses — seeded automatically, owned by you.** Which subassembly is a mechanism, what kind of joint it is, what carries what, which device maps where. None of that is in a STEP file — Onshape exports no kinematics — so no amount of tuning makes it reliable. The bench drafts it, marks every guess, and hands it to you to confirm.

## Built after studying

| Tool | What it does well | What the bench took from it |
|---|---|---|
| [virtual_robot](https://github.com/Beta8397/virtual_robot) (Beta8397) | Runs real OpModes against a 2D field, with explicit errors | The INIT / START / STOP flow, and reporting what can't run instead of failing silently |
| [Virtual Robot Simulator](https://www.vrobotsim.com/) | Browser-based, gamepad-driven TeleOp on the season field | A browser-only tool with a virtual gamepad |
| [FTC Dashboard](https://acmerobotics.github.io/ftc-dashboard/) | Live `@Config` variables, telemetry graphs | Live-editable config variables, and the telemetry graph |
| [AdvantageScope](https://github.com/Mechanical-Advantage/AdvantageScope) | Log viewer with line graphs and a 3D field | Hover readouts and small-multiple graphs — one y-axis per chart, not two |

## Run it

Open `docs/index.html` in a browser, or use the live link. To work on it:

```bash
npm run build     # src/ → dist/ftc-sim-bench.html, dist/preview.html, docs/index.html
npm test          # 34 tests, node --test, no dependencies
```

Zero runtime dependencies beyond three.js (r128, from cdnjs) and Google Fonts.

## Project layout

```
src/
  hardware.js     actuator database, part-number recognition, spec precedence (code vs CAD)
  samples.js      built-in robot and three sample OpModes
  step.js         STEP parser, assembly transforms, mechanism detection, the kinematic rig
  expr.js         expression grammar and evaluator
  java.js         OpMode → statement tree, bindings, coverage, config fields
  mapping.js      device ↔ mechanism matching, drivetrain detection
  robotconfig.js  Robot Controller configuration .xml: parse and check hardwareMap names
  compare.js      control-by-control diff of two OpModes
  analyze.js      findings
  sim.js          Driver Station lifecycle, 50 Hz interpreter, autonomous stepper, encoders, PID, chassis
  view3d.js       three.js field and articulated robot        (browser only)
  app.js          UI: tabs, gamepad, graph, rig editor, intake  (browser only)
tests/
  engine.test.mjs, features.test.mjs   run the real engine files in Node
  fixtures/        hand-written STEP assembly, competition-style OpMode, robot configuration
tools/build.mjs    single-file bundle for Pages and for sharing
```

## Honest limits

- **Torque figures are estimates**: published stall torque, a lever measured from CAD, and a payload you set. They tell you which joint to go measure.
- **Don't tune PID gains here.** Motors have no inertia, gravity load or friction; use the bench to check *which way* a target drives a mechanism.
- The interpreter covers the constructs TeleOps and autonomous routines actually use; it does not compile arbitrary Java. Anything it can't run is listed with its line number.
- Calls into your own classes and path followers (Road Runner, Pedro Pathing) aren't simulated.

## License

MIT
