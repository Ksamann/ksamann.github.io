# Banepuls – notes on the data (checked 27 Nov 2026)

Source: Entur Journey Planner v3 (`https://api.entur.io/journey-planner/v3/graphql`, open, CORS enabled, client name `ksamann-banepuls`).

| Question | Finding | Consequence in the app |
|---|---|---|
| Actual times for the metro? | Yes, `actualArrivalTime` / `actualDepartureTime` with second resolution. Usually one timestamp per stop (arrival = departure); sometimes two. | Dwell times come only from the user's taps. Δ is computed for both arrival and departure taps. |
| Actual = plan? | Many actual times equal the aimed time exactly on the whole minute (e.g. 21:39:00). | Flagged `rt_equals_plan` (shown as ≈) and left out of accuracy figures. |
| How long are actual times available? | About 60–90 minutes after the train passes; after that `actual*` is null. | Realtime for the departure is polled every 20 s during a trip and fetched again 1, 3 and 10 min after it; nothing after 70 min. |
| Whole departure | `serviceJourney(id){ estimatedCalls(date) }` returns every stop with aimed/expected/actual. The service date comes from `estimatedCalls{ date }`. | A time study uses the departure's own stops as its route. |
| Clock | Entur does not expose the `Date` header to browsers (no `Access-Control-Expose-Headers`). | Clock sync uses HEAD requests to the app's own origin, several samples spread over the second, intersected to about ±0.1–0.5 s. |
| Nearest station | `nearest(...)` works, but stop coordinates also come with the network query. | Nearest station is computed on the phone, so it also works offline. |
| Service messages | `lines{ situations }` per line. | Shown on the station view and when choosing a train. |
