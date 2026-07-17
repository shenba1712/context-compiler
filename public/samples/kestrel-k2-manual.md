# Kestrel K2 Drone — User Manual

## Safety first

Read this section even if you read nothing else. Keep fingers, hair, and
pets away from spinning propellers. Never fly over crowds. The K2 is not
a toy; treat it like a power tool that can leave.

## What's in the box

One K2 drone, one controller, two flight batteries, one charger, eight
spare propellers (four clockwise, four counter-clockwise — they are not
interchangeable), one USB-C cable, and one lens cloth. The carry case is
sold separately.

## Before your first flight

Charge both batteries fully. Update the firmware via the Kestrel app
before the first flight — out-of-date firmware is the single most common
cause of support tickets. Calibrate the compass by rotating the drone
horizontally 360°, then vertically 360°, away from metal structures and
parked cars. Find an open field. Resist the urge to fly indoors on day
one; everyone regrets it.

## Controls

Left stick: altitude and rotation. Right stick: forward, back, and
strafing. Press and hold the home button for three seconds to trigger
Return-to-Home (RTH). In RTH the drone climbs to 30 metres, returns to
its launch point, and lands within a 1.5-metre radius. RTH also triggers
automatically when the battery falls below 15% or the signal is lost for
more than 8 seconds.

## Battery and charging

Each battery gives up to 27 minutes of flight in calm conditions —
expect 20–22 minutes with wind or aggressive flying. A full charge takes
90 minutes. Batteries must be stored at 40–60% charge; storing them full
for more than a week permanently reduces capacity. The battery LED blinks
red when cell temperature is outside 5–40°C; the drone will refuse to arm
until the battery is back in range.

## Camera and gimbal

The K2 records 4K at 30fps and 1080p at 120fps. The gimbal levels itself
on startup — do not hold or "help" it, this is the second most common
cause of support tickets. Cinematic mode halves stick sensitivity and
smooths acceleration; use it for anything you intend to show other
people.

## Flight modes

Standard mode balances speed and stability. Sport mode raises top speed
to 68 km/h but disables obstacle sensing entirely — treat it as expert
mode. Tripod mode caps speed at 8 km/h for close-quarters shots. Orbit,
Follow, and Waypoint modes require a GPS lock of at least 10 satellites.

## Error codes

| Code | Meaning | What to do |
|---|---|---|
| E1 | Compass interference | Move 10 m from metal/concrete, recalibrate |
| E2 | GPS lock lost | Hover manually; wait or fly home visually |
| E3 | Gimbal obstruction | Remove gimbal guard; check for sand/grit |
| E4 | Battery cell imbalance | Land promptly; recharge fully before next flight |
| E5 | Motor overload | Land; check propellers for damage or entangled debris |
| E6 | Storage full | Delete footage or swap the microSD card |
| E7 | Firmware mismatch | Update controller and drone to the same version |

## Maintenance

Inspect propellers before every flight; replace at the first sign of a
chip or hairline crack — propellers cost far less than motors. Clean the
obstacle sensors weekly with the supplied lens cloth. Every 50 flight
hours, check motor bearings for play and update the firmware.

## Where you may not fly

Respect local regulations: no-fly zones typically include airports
(usually within 5 km), military areas, and national parks. The app shows
a live restriction map, but the map is advisory — the law is not. You
are the pilot in command; "the app didn't warn me" has never once worked
as a legal defence.

## Storage and travel

Store the drone in a dry case between 0–35°C. For air travel, batteries
must go in carry-on luggage, never checked baggage, with terminals
protected. Discharge to 30% before flying commercially.

## Warranty

The K2 carries a 24-month warranty covering manufacturing defects. The
warranty does not cover crash damage, water ingress, or any drone that
has flown with third-party propellers. Warranty claims require the flight
log from the app — one more reason not to fly with the app logged out.

## Technical specifications

| Spec | Value |
|---|---|
| Weight | 892 g |
| Max speed | 68 km/h (Sport) |
| Flight time | up to 27 min |
| Range | 6 km (line of sight) |
| Camera | 4K/30fps, 1/1.7" sensor |
| Wind resistance | up to 38 km/h |
| Operating temp | 0–40°C |

## Pairing the controller and app

Power on the controller first, then the drone. Hold the pairing button
on the drone's belly for four seconds until the tail LED flashes blue;
the controller chimes once when linked. The app connects to the
controller over USB-C, not directly to the drone — a common confusion.
If pairing fails three times, reset the link by holding both power
buttons for ten seconds, and re-attempt with the devices within one
metre of each other.

## Obstacle sensing — what it can and cannot see

The K2 senses obstacles forward, backward, and downward — **not
sideways and not upward**. Sensors struggle with thin branches, power
lines, glass, and water surfaces. Obstacle sensing slows the drone but
does not guarantee a stop at speeds above 43 km/h. In Sport mode it is
off entirely. Around trees and wires, fly as if the feature does not
exist; it is a seatbelt, not a chauffeur.

## Intelligent flight features

Orbit circles a subject at a radius you set between 5 and 50 metres.
Follow tracks a person at up to 25 km/h and will not follow into areas
without GPS. Waypoint flies a route of up to 30 pinned points and can
repeat it — useful for construction progress shots taken weekly from
identical positions. QuickShots (Rocket, Helix, Boomerang) are
one-button cinematic patterns; check airspace above you before Rocket,
which climbs 40 metres vertically.

## Filming settings that actually matter

Shoot 4K/30 with the ND8 filter in bright daylight; motion looks natural
at a shutter speed near double the frame rate. Turn on zebra stripes to
catch blown-out skies. Record in D-Log only if you intend to
colour-grade; otherwise Normal profile saves an evening of your life.
White-balance manually before flights that cross from sun to cloud —
auto WB shifting mid-shot is unfixable in edit.

## Firmware and the flight log

Firmware updates arrive roughly quarterly and are cumulative. The
version installed shows in the app under Settings → About. Updates are
blocked below 40% battery — deliberately, after early units bricked
during mid-update power loss. Every flight writes a log (route,
battery, warnings) stored locally for 12 months; export logs before
selling the drone, and include them with any warranty claim — claims
without logs are processed as goodwill cases at Kestrel's discretion,
which is a slower and less generous path.

## Propeller replacement

Clockwise and counter-clockwise propellers are marked with and without
a silver ring — matching the mark on each motor hub. Press down and
twist a quarter-turn to release. Torque by hand only; tools crack the
hub. After any propeller strike, even one that leaves no visible mark,
replace the pair on that motor: hairline fractures fail at full thrust,
not at rest.

## Frequently asked questions

**Can it fly in rain?** No. The K2 is not water-resistant; humidity
above 90% can fog the lens and corrode motor windings.
**Can I fly at night?** The drone can; whether you may depends on local
rules. The forward sensors are camera-based and degrade badly in the
dark — rely on GPS hold and the strobe.
**Why is my flight time only 19 minutes?** Wind, cold, Sport mode, and
battery age all reduce it. A battery past 200 charge cycles retains
roughly 80% capacity.
**Can I use my phone's charger?** Only if it is USB-PD 30W or higher;
weaker chargers appear to work but never complete the balance phase.

## Disposal and recycling

Lithium batteries must not go in household waste. Kestrel dealers accept
old batteries regardless of where you bought them. Tape the terminals
before transport. The airframe is 61% recyclable by weight; the app can
generate a disassembly guide for certified e-waste processors.

## Quick pre-flight checklist

1. Propellers: correct rotation marks, no chips.
2. Battery: above 90%, firmly clicked in.
3. GPS: at least 10 satellites before any automated mode.
4. Home point: recorded (the app announces it).
5. Airspace: checked in the app *and* with your own eyes.
6. RTH altitude: set above the tallest obstacle within 100 m.
