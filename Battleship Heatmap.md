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

[V] Allow multiple hot spots (green) if chances are very close within min-max range

[V] style mobile buttons / create context menu

[V] disallow the boat lengths field to contain a boat larger than any dimension

[ ] Fix input bug, when changing the cols dimension upwards by clicking "start" when the cols-changed event hasn't fired yet causes an error in
accumulateHeatmap:

    Uncaught TypeError: Cannot read properties of undefined (reading '0')
    at BattleshipHeatmap.accumulateHeatmap (heatmap.ts:153:45)
    at Worker.<anonymous> (heatmap.ts:184:24)

[ ] Fix resize bug, when entering 10, doing enter to start, enter 100 (which is to big), get window alert, its reset to 10 but the generation conitnues but there no visual output

[V] Instead of counting S (sunken) as H (hit), sunken boats should be taken out of the randomly placed boats AND should be surrounded with water
OR the boats should be placed on the S's, whichever is more performant

[ ] fix bug where 17 attempts, 1 succes and 0 output. Likely its not processing workers properly after the timer is done and something else.

[ ] fix UI Bug: Pressing enter in an input field twice causes UI to show as if it stopped generating, until the generation timer finishes and updates the heatmap at once proving it was generating the whole time.

[ ] add a place with information such as keyboard controls (put it in the grid wrapper top left, make mobile friendly)

[ ] Update generation algorithm: if 2 H's are next to eachother, it means there is a boat lying there which is at least 3 long, because if it were only 2 it should have been sunken already (marked with S's)

[ ] when allow touching is on, users must be able to mark the direction of each segment.

[V] create workers once and store them instead of closing and recreating them, in an attempt to lose less time at the beginning of the generation process.

[ ] make a proper shared lock so snapshot() does not copy data thats being mutated by the workers, which causes a race condition

## Nice to have

[ ] use bow classes to shape sunken boats (only when "allow touching" is off)

[ ] change neighboring H's to S when "allow touching" is off

[ ] display letters and numbers next to grid

[ ] use modals instead of window.alert() for errors + better error messages
