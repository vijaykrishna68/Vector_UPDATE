# Vector Allocation Engine

A manufacturing planning system that automatically allocates weekly production demand across multiple production lines while respecting line capacity constraints.

The system processes Excel schedules, calculates required working days, allocates production quantities to available lines, detects capacity overloads, and generates an updated Excel output with the final production plan.

---

# Problem Statement

In a manufacturing environment, planners receive weekly demand quantities for hundreds of parts.

Each part has:

* A specification (Part ID)
* Assigned production line
* Cycle time
* Weekly demand quantity

The challenge is:

* Different production lines have different capacities.
* Some lines can act as backup lines.
* Demand may exceed available capacity.
* Manual planning is time-consuming and error-prone.

This project automates the entire allocation process.

---

# What This System Does

Input:

* Excel production planning sheet
* Weekly demand quantities
* Cycle times
* Production line assignments

Output:

* Allocated quantities for every working day
* Actual working days required
* Capacity utilization per line
* Remaining unallocated demand
* Overload reports
* Updated Excel schedule

---

# High-Level Allocation Flow

```text
Excel Upload
      │
      ▼
Read Weekly Demand
      │
      ▼
Calculate Working Days
      │
      ▼
Group Parts By Production Line
      │
      ▼
Allocate Daily Quantities
      │
      ▼
Check Capacity Constraints
      │
      ▼
Use Fallback Lines
      │
      ▼
Generate Final Schedule
      │
      ▼
Export Updated Excel
```

---

# Production Line Configuration

The factory contains four production lines.

| Line | Workers | Daily Capacity (minutes) |
| ---- | ------- | ------------------------ |
| 1    | 3       | 1425                     |
| 2    | 4       | 1900                     |
| 3    | 2       | 950                      |
| 4    | 3       | 1425                     |

Capacity is calculated as:

```text
Workers × 475 minutes
```

Example:

```text
Line 2

4 workers × 475

= 1900 minutes/day
```

---

# Weekly Processing

The system processes three weeks independently.

| Week   | Excel Column |
| ------ | ------------ |
| Week 1 | BU           |
| Week 2 | BV           |
| Week 3 | BW           |

Each week is allocated separately.

---

# Step 1: Read Valid Parts

The allocator scans the Excel sheet and only considers:

```text
Component Unit = PC
```

For every valid row it extracts:

* Spec
* Original Line
* Cycle Time
* Weekly Quantity

Invalid records are automatically reported.

Examples:

* Missing Spec
* Negative Quantity
* Invalid Cycle Time

---

# Step 2: Merge Duplicate Parts

If the same:

```text
Spec + Week
```

appears multiple times:

```text
ABC123 + BU
ABC123 + BU
ABC123 + BU
```

the system merges them into a single demand.

Example:

```text
100
200
300

↓

600
```

This prevents duplicate allocation.

---

# Step 3: Calculate Actual Working Days

Total demand:

```text
SUM = Total Weekly Quantity
```

Factory Daily Capacity:

```text
3000 parts/day
```

Working days are calculated as:

```text
Actual Working Days

= Ceiling(
    SUM / 3000
  )
```

Example:

```text
SUM = 7200

7200 / 3000

= 2.4

Ceiling(2.4)

= 3 Days
```

These values are written back into the Excel file automatically.

---

# Step 4: Build Daily Targets

For each line:

```text
Daily Target

= Ceiling(
    Weekly Quantity /
    Working Days
)
```

Example:

```text
Line 2 Total Demand

= 1000

Working Days

= 5

Daily Target

= 200
```

This evenly spreads production throughout the week.

---

# Step 5: Capacity-Aware Allocation

This is the heart of the algorithm.

For every day:

```text
Day 1
Day 2
Day 3
...
```

The allocator distributes quantities while checking:

```text
Remaining Capacity
=
Available Minutes
```

Required minutes:

```text
Allocated Qty × Cycle Time
```

Example:

```text
50 Parts

Cycle Time = 12

Required

50 × 12

= 600 Minutes
```

The allocation is only accepted if sufficient capacity exists.

---

# Priority Order

Lines are allocated in the following order:

```text
3 → 2 → 4 → 1
```

Reason:

The factory prioritizes production according to business requirements.

This ensures critical lines are scheduled first.

---

# Fallback Line Strategy

Some lines can borrow capacity from other lines.

Fallback chains:

```text
Line 3 → Line 3 only

Line 2 → Line 2 → Line 4

Line 4 → Line 4 → Line 1

Line 1 → Line 1 only
```

Example:

```text
Part belongs to Line 2

Line 2 Full

↓

Try Line 4

↓

Allocate Remaining Quantity
```

This significantly improves factory utilization.

---

# Example Allocation

Suppose:

```text
Part A

Line = 2

Weekly Qty = 500

Cycle Time = 10
```

Daily target:

```text
100 units/day
```

Day 1:

```text
Line 2 Capacity Available

Allocate 70
```

Remaining:

```text
30
```

Fallback:

```text
Line 4

Allocate 30
```

Final:

```text
Line 2 → 70
Line 4 → 30
```

Demand fully satisfied.

---

# Step 6: Extra-Day Extension

After normal scheduling:

```text
Remaining Quantity
```

is checked.

Tolerance:

```text
20 units
```

If any line still has:

```text
Remaining > 20
```

the allocator automatically extends scheduling into additional available date columns.

This prevents large quantities from being left unallocated.

---

# Error Detection

The engine automatically detects:

## Invalid Input

Examples:

* Missing Spec
* Negative Quantity
* Invalid Cycle Time

---

## No Capacity

Triggered when:

```text
Demand cannot be allocated
```

even after using fallback lines and extension days.

---

## Overload

Triggered when:

```text
Total Demand Minutes

>

Total Available Capacity Minutes
```

The system reports:

```text
Overload Minutes
```

so planners know exactly how much capacity is missing.

---

# Data Stored

After allocation the system stores:

## Run

Represents one uploaded Excel file.

---

## Machine

Represents a production line.

Example:

```text
Line 1
Line 2
Line 3
Line 4
```

---

## Job

Represents:

```text
Spec + Week
```

combination.

---

## Allocation

Represents:

```text
Job
↓
Machine
↓
Day
↓
Assigned Quantity
```

This enables detailed allocation tracking.

---

# Time Complexity

Let:

```text
P = Number of Parts

D = Number of Days

L = Number of Lines
```

Allocation complexity:

```text
O(P × D × L)
```

Since:

```text
L = 4
```

the algorithm scales efficiently for large production schedules.

---

# Key Design Decisions

### Capacity First

Never exceed machine capacity.

### Even Distribution

Spread work across all working days.

### Fallback Support

Use alternate lines when primary lines are full.

### Error Visibility

Never silently ignore overloads.

### Excel Compatibility

Works directly with planner spreadsheets.

---

# Interview Summary

This project is a capacity-constrained production scheduling system.

The allocator:

1. Reads weekly demand from Excel.
2. Calculates required working days.
3. Creates daily production targets.
4. Allocates quantities using available line capacity.
5. Uses fallback lines when primary lines are full.
6. Extends scheduling if demand remains.
7. Detects overloads and capacity shortages.
8. Generates an updated production plan and analytics.

The goal is to maximize production allocation while respecting factory capacity constraints.
