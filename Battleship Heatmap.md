# Battleship Heatmap

## Required

[V] improve color contrast on grids with similar values

[V] highlight the square with the highest hit probability (exclude hit and sunk markers)

[V] show sunken boats based on S's on the grid

[V] Fix bug where green sometimes doesn't keep its classname

[V] show error when the lengths of the sunken boats to not match
find out how to handle a square of sunken boats when allow touching is on

[V] style "clear grid" button red

[V] change "generate heatmap" button to "stop" or "abort" when generating

[V] make blue cursor more visible over blue cells

[V] When a modifier is down, ignore the keypress

[V] Allow multiple hot spots (green) if heat values are very close within min-max range

[V] style mobile buttons / create context menu

[V] disallow the boat lengths field to contain a boat larger than any dimension

[?] Should this be fixed? Fix input bug, when changing the cols dimension upwards by clicking "stop" when the cols-changed event hasn't fired yet but its already generating, causes regeneration instead of stopping.

[V] Fix IO bug: enter 10x10, press enter to start generation in the rows/cols input, enter 100 (which is to big), press enter, get window alert. Value is reset to 10 but generation (re)starts. Should not (re)start. Stop or do nothing.

[V] Instead of counting S (sunken) as H (hit), sunken boats should be taken out of the randomly placed boats AND should be surrounded with water
OR the boats should be placed on the S's, whichever is more performant

[?] Cannot reproduce anymore due to efficiency boost: Fix bug where 17 attempts, 1 succes and 0 output. Likely its not processing workers properly after the timer is done and something else.

[V] fix UI/IO Bug: Pressing enter in an input field twice causes UI to show as if it stopped generating, until the generation timer finishes and updates the heatmap at once proving it was generating the whole time.

[V] create workers once and store them instead of closing and recreating them, in an attempt to lose less time at the beginning of the generation process.

[V] make a proper shared lock so snapshot() does not copy data thats being mutated by the workers, which causes a race condition.

[ ] Update generation algorithm: if 2 H's are next to eachother, it means there is a boat lying there which is at least 3 long, because if it were only 2 it should have been sunken already (marked with S's)

[ ] when allow touching is on, users must be able to mark the direction of each segment because logic alone cannot pinpoint what type of boats are laying in a 2x3 rectangle of H's (2x 3 long) or (3x 2 long).

[ ] add a place with information such as keyboard controls (put it in the grid wrapper top left, make mobile friendly)

[ ] Use modals instead of window.alert() for errors.

[ ] use bow classes to shape sunken boats (only when "allow touching" is off). CSS code is already present.

## Nice to have

[ ] User friendly error messages (include error_status so it can be mapped to user friendly messages?).

[ ] Display letters and numbers next to grid (1-26, A-Z).

[ ] Change neighboring H's to S when "allow touching" is off. (Should be toggleable?).
