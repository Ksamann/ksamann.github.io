# Metro timing logger – team setup (admin guide)

This guide sets up team collection for the T-bane timing logger (`tbane.html`) inside your own Microsoft 365 tenant. Loggers tap **Submit to team** on their phone. That opens an email to a shared mailbox with the trip data in the body. Power Automate reads the email, writes rows to two SharePoint lists, and replies with a thank-you. Power BI (or Excel) reads the lists for the dashboard and leaderboard.

```
Phone (tbane.html) ──Submit──► Shared mailbox ──► Power Automate ──► SharePoint lists ──► Power BI / Excel
                    (Outlook/Mail)                   (parse JSON)      TbaneTrips             dashboard,
                                                                       TbaneSegments          leaderboard
```

No trip data passes through GitHub or any service outside the tenant. GitHub Pages only serves the app's code. Everything needs standard Microsoft 365 licences only: Outlook, SharePoint, Power Automate with standard connectors, and Power BI Pro or Excel for the dashboard.

---

## 0. Before you start: privacy and agreements

Agree on these points with the data protection officer and, if relevant, the employee representatives (tillitsvalgte):

| Topic | Proposal |
|---|---|
| Purpose | Measure real running and dwell times on the T-bane to improve timetables and planning. |
| Participation | Voluntary. Only employees with a work account. |
| What is stored | Trip times, line, stations, train number (optional), the logger's work email (sender) and name, and an optional nickname. |
| Who sees raw data | Members of the closed SharePoint site (the pilot admins). |
| What others see | Aggregated times and a leaderboard with **nicknames only**, and only for people who opted in. |
| Not a driver assessment | Data is not used to assess individual drivers. Say so in the pilot description. |
| Retention | Raw rows deleted after 24 months, using a SharePoint retention label. |
| Contact | Name of the pilot owner, written in the app guide and the reply email. |

---

## 1. Shared mailbox

1. Ask IT (or use the Exchange admin centre) to create a shared mailbox, for example `tbane-logg@sporveien.no`.
2. Give the person who will own the flow **Full access** to it.
3. Optional: set an automatic reply off; the flow sends its own reply.

## 2. SharePoint site and lists

Create a **private** team site or a communication site with restricted membership, for example *T-bane timing pilot*. Then create two lists.

### List `TbaneTrips`

Rename **Title** to *TripId*. Then add these columns:

| Column | Type | Notes |
|---|---|---|
| TripId | Single line (Title) | Unique trip id, e.g. `TMWTJX1NC` |
| Line | Single line | `1`–`5` |
| Direction | Single line | Terminus travelled towards |
| StartStation | Single line | |
| EndStation | Single line | Last station logged |
| StartedAt | Date and time | Include time |
| EndedBy | Single line | `auto` or `manual` |
| SubmittedBy | Single line | Sender email, filled by the flow |
| Observer | Single line | Name typed in the app |
| Nickname | Single line | Empty unless the logger opted in |
| Leaderboard | Yes/No | Opt-in |
| Train | Single line | |
| TripNote | Multiple lines | |
| Legs | Number | |
| TotalS, RunS, DwellS | Number (1 decimal) | Seconds |
| UndoCount | Number | |
| Quality | Single line | `ok` or `review` from the app |
| Flags | Single line | e.g. `run_short@3 dwell_long@7` |
| Points | Number | Provisional points from the app |
| Status | Choice: `Approved`, `Review`, `Rejected` | Set by the flow, changed by admins |
| AppVersion, DeviceId | Single line | For troubleshooting |

### List `TbaneSegments`

Rename **Title** to *SegmentKey*. Then add these columns:

| Column | Type | Notes |
|---|---|---|
| SegmentKey | Single line (Title) | `TripId-seq`, e.g. `TMWTJX1NC-3` |
| TripId | Single line | Indexed (List settings → Indexed columns) |
| Line | Single line | |
| Seq | Number | |
| Station | Single line | Station where the dwell was measured and the leg starts |
| ToStation | Single line | Empty on the last row |
| Arrival | Date and time | |
| Departure | Date and time | |
| DwellS | Number (1 decimal) | |
| RunS | Number (1 decimal) | Departure here → arrival at ToStation |
| Hour | Number | Hour of departure (local time) |
| Weekday | Number | 1 = Monday … 7 = Sunday |
| StationNote | Single line | |

Add a **retention label** of 24 months to both lists, or ask your Microsoft 365 admin to do it.

## 3. Point the app at the mailbox

Choose one of these:

- **Same for everyone:** edit `tbane.html` and set `const TEAM = { submitEmail: "tbane-logg@sporveien.no" };`. Then commit.
- **Per invitation link:** send pilot members this link and ask them to open it once, then add the app to their home screen:
  `https://ksamann.github.io/tbane.html?submit=tbane-logg@sporveien.no`
  The address is remembered on that phone.

When an address is set, the trip summary shows **Submit to team**, and History marks each trip *Submitted* or *Not submitted*.

## 4. Power Automate flow

Create an **Automated cloud flow** named *T-bane trip intake*.

1. **Trigger:** *When a new email arrives in a shared mailbox (V2)* (Office 365 Outlook).
   - Original mailbox address: `tbane-logg@sporveien.no`
   - Folder: Inbox
   - Include attachments: **Yes**
   - Subject filter: `[TBANE]`
2. **Condition:** *Sender domain*. Check that `toLower(triggerOutputs()?['body/from'])` **ends with** `@sporveien.no`. If not, end the flow. This stops outside senders.
3. **Html to text** (Content Conversion). Content: the trigger's *Body*.
4. **Compose**, renamed *JsonText*. Expression:

   ```
   if(
     contains(body('Html_to_text'), '----- TBANE-JSON START -----'),
     replace(replace(trim(first(split(last(split(body('Html_to_text'), '----- TBANE-JSON START -----')), '----- TBANE-JSON END -----'))), decodeUriComponent('%0D'), ''), decodeUriComponent('%0A'), ''),
     base64ToString(first(triggerOutputs()?['body/attachments'])?['contentBytes'])
   )
   ```

   - The `replace` calls remove line breaks that mail apps insert when they wrap long lines. The JSON itself has no line breaks, so this is safe.
   - The fallback reads the attached `.json` file. The app sends a file instead of a body only for unusually long trips.
5. **Parse JSON.** Content: `outputs('JsonText')`. Schema: paste the contents of [`tbane-schema.json`](tbane-schema.json).
6. **Get items** (SharePoint) from `TbaneTrips`, with Filter Query `Title eq '@{body('Parse_JSON')?['trip_id']}'`. This catches re-submissions.
7. **Condition:** `length(body('Get_items')?['value'])` is greater than 0.
   - **If yes**, it is a re-submission. Do these steps:
     - **Update item** on the first match with the fields from step 8.
     - **Get items** from `TbaneSegments` with Filter `TripId eq '…'`.
     - **Apply to each** of those: **Delete item**.
   - **If no**, it is a new trip. Do step 8.
8. **Create item** in `TbaneTrips`:
   - Title ← `trip_id`
   - Line, Direction, StartStation, EndStation, Observer, Nickname, Leaderboard, Train, TripNote, Legs, TotalS, RunS, DwellS, UndoCount, Quality, Flags, Points, AppVersion, DeviceId ← the matching JSON fields
   - StartedAt ← `started_at`
   - SubmittedBy ← trigger *From*
   - Status ← `if(equals(body('Parse_JSON')?['quality'],'ok'),'Approved','Review')`
9. **Apply to each** `segments`, then **Create item** in `TbaneSegments`:
   - Title ← `concat(body('Parse_JSON')?['trip_id'],'-',items('Apply_to_each')?['seq'])`
   - TripId, Line ← from the trip
   - Seq, Station, ToStation (`to`), DwellS, RunS, StationNote (`note`) ← from the item
   - Arrival ← `items('Apply_to_each')?['arr']`; Departure ← `items('Apply_to_each')?['dep']`. Both may be empty.
   - Hour ← `if(empty(items('Apply_to_each')?['dep']), null, int(formatDateTime(convertTimeZone(items('Apply_to_each')?['dep'],'UTC','W. Europe Standard Time'),'HH')))`
   - Weekday ← `if(empty(items('Apply_to_each')?['dep']), null, add(mod(add(dayOfWeek(convertTimeZone(items('Apply_to_each')?['dep'],'UTC','W. Europe Standard Time')),6),7),1))`
10. **Reply to email (V3)**, or *Send an email from a shared mailbox*, to the sender. For example:
    > Thanks! Trip @{body('Parse_JSON')?['trip_id']} (line @{body('Parse_JSON')?['line']}, @{body('Parse_JSON')?['legs']} legs) has been received. Provisional points: @{body('Parse_JSON')?['points']}. @{if(equals(body('Parse_JSON')?['quality'],'ok'),'','Some times will be checked before points count.')}
11. **Move email** to a folder named *Processed*. If the flow fails, the email stays in the Inbox and you can re-run it.

**Error handling:** add a parallel branch after *Parse JSON* that is configured to run when *Parse JSON* has failed. It moves the email to a folder named *Failed* and notifies the admin.

## 5. Review routine (weekly, 10 minutes)

- Open `TbaneTrips` filtered on **Status = Review**. The *Flags* column says what looked odd:

  | Flag | Meaning |
  |---|---|
  | `run_short@n` | Run time from stop *n* is under 20 s |
  | `run_long@n` | Run time from stop *n* is over 10 min |
  | `dwell_short@n` | Dwell at stop *n* is under 5 s |
  | `dwell_long@n` | Dwell at stop *n* is over 5 min |
  | `many_undos` | Undo used 5 or more times |
  | `clock_jump` | The phone clock went backwards during the trip |
  | `ended_early` | Trip ended before the planned end. This is information only and doesn't trigger review. |

- Look at the segments for that trip. Long dwells are often real, for example a signal or doors. Set **Approved** or **Rejected**.
- The limits are set in `const Q` near the top of `tbane.html`.

## 6. Dashboard

### Power BI (recommended)

1. **Get data → SharePoint Online list.** Use the site URL and load `TbaneTrips` and `TbaneSegments`.
2. In Power Query:
   - Keep the columns you need and set the types to number and datetime.
   - On `TbaneSegments`, add a **Leg** column: `[Station] & " → " & [ToStation]`.
   - Add a **TimeBand** column: Peak if a weekday and Hour is 7–8 or 15–16, Evening if Hour ≥ 20 or < 6, Weekend if Weekday ≥ 6, otherwise Day.
3. **Relationship:** `TbaneTrips[TripId]` 1 → * `TbaneSegments[TripId]`. Add a report-level filter of `TbaneTrips[Status] = "Approved"`.
4. **Measures** (DAX):

   ```DAX
   Run median (s)   = MEDIAN ( TbaneSegments[RunS] )
   Run P10 (s)      = PERCENTILEX.INC ( FILTER ( TbaneSegments, NOT ISBLANK ( TbaneSegments[RunS] ) ), TbaneSegments[RunS], 0.10 )
   Run P90 (s)      = PERCENTILEX.INC ( FILTER ( TbaneSegments, NOT ISBLANK ( TbaneSegments[RunS] ) ), TbaneSegments[RunS], 0.90 )
   Dwell median (s) = MEDIAN ( TbaneSegments[DwellS] )
   Measurements     = COUNTROWS ( FILTER ( TbaneSegments, NOT ISBLANK ( TbaneSegments[RunS] ) ) )
   Loggers          = DISTINCTCOUNT ( TbaneTrips[SubmittedBy] )
   Points           = SUM ( TbaneTrips[Points] )
   ```

5. **Pages:**
   1. **Running times:** a matrix with Leg in rows and TimeBand in columns, showing *Run median* and *Measurements*. Add a line and direction slicer.
   2. **Dwell times:** stations by *Dwell median* as a bar chart, sorted, with the top 10.
   3. **Time of day:** a matrix heatmap of Leg × Hour with *Run median*, using conditional formatting.
   4. **Coverage:** Leg × TimeBand by *Measurements*, with conditional formatting where white means none. This page shows where data is missing. Share it with loggers.
   5. **Team:** trips and legs per week, and active *Loggers*. The **Leaderboard** is a table of `TbaneTrips[Nickname]` and *Points*, filtered to Leaderboard = Yes, Nickname not blank, and the current month.
   6. **Quality:** share of trips in Review or Rejected, and flags by type.
6. Publish to a workspace that only the pilot group can access. Add pages 4 and 5 as a **Teams tab** in the pilot channel. They show nicknames and aggregates only.

### Excel (if there is no Power BI licence)

Use **Data → Get Data → From SharePoint Online list** in Excel for the web or desktop. Build pivot tables with Leg × TimeBand and *Median* via `AGGREGATE` or `MEDIAN(IF(...))`. Store the workbook in the pilot site and set it to refresh on open.

## 7. Bonuses and prizes (optional, monthly)

The app's points are provisional and use only what that phone knows. Monthly, you can add team-level bonuses in Power BI or by hand:

- **Coverage bonus ×3** for legs and time bands with fewer than 5 measurements before that trip. These are the white cells on the coverage page.
- **Double-confirmed +3** when two different loggers have the same leg with departures less than 60 s apart. Their difference also tells you how precise the data is.
- **Monthly draw:** each approved point is one ticket. Announce the winner, by nickname, in the Teams channel and on the intranet. Also share one finding a month that the data showed, so people see their logging being used.

## 8. Test checklist

1. Open `tbane.html?submit=<your mailbox>` on a phone, log a short trip, and tap **Submit to team** → **Send**.
2. Check the following:
   - The flow run succeeds.
   - `TbaneTrips` has one row and `TbaneSegments` has one row per stop.
   - The times are in local time.
   - The reply arrives.
3. Submit the same trip again (**Submit again**). It should update, not duplicate.
4. Send an email with subject `[TBANE] test` and a broken body. It should end in *Failed*.
5. To test the flow without a phone, paste a sample payload between the markers in an email. The app's History → JSON export follows the same structure. A sample of the submission format looks like this:

```json
{"app":"tbane-tidslogger","kind":"submission","version":2,"app_version":"2.0.0","device_id":"D6HK1TGRM","trip_id":"T3","line":"3","direction":"Kolsås","start_station":"Bogerud","end_station":"Skøyenåsen","planned_end_station":"Skøyenåsen","started_at":"2026-11-24T21:41:42.995+01:00","ended_at":"2026-11-24T21:49:22.995+01:00","ended_by":"auto","observer":"Kari","nickname":"Rakett","leaderboard":true,"train":"","note":"","legs":2,"total_s":205,"run_s":180,"dwell_s":25,"undo_count":0,"quality":"ok","flags":"","points":8,"segments":[{"seq":1,"station":"Bogerud","arr":null,"dep":"2026-11-24T21:41:42.995+01:00","dwell_s":null,"to":"Bøler","run_s":90,"note":""},{"seq":2,"station":"Bøler","arr":"2026-11-24T21:43:12.995+01:00","dep":"2026-11-24T21:43:37.995+01:00","dwell_s":25,"to":"Ulsrud","run_s":90,"note":""},{"seq":3,"station":"Ulsrud","arr":"2026-11-24T21:45:07.995+01:00","dep":null,"dwell_s":null,"to":null,"run_s":null,"note":""}]}
```

Put it in the email body like this:

```
----- TBANE-JSON START -----
{ ...json... }
----- TBANE-JSON END -----
```

## 9. Phase 2: automatic upload (when the pilot has proven its value)

This needs IT:

- **App registration** in Entra ID: platform *Single-page application*, with the redirect URI set to the app's address.
- **API permission:** Microsoft Graph `Sites.Selected` (delegated), granted to the pilot site only.

Then the app can get **Sign in with Sporveien account** (MSAL.js) and write directly to the same two lists through Microsoft Graph. It would keep a queue on the phone while offline and send it later. It could also show the team leaderboard and coverage map inside the app. The lists, review routine and dashboard in this guide stay the same, so phase 1 data carries over.
