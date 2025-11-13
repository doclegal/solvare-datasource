# Design Guidelines: Dutch Court Decision Ingestion Application

## Design Approach

**System Selected:** Material Design 3 with Carbon Design influences  
**Rationale:** This data-intensive productivity tool requires clear information hierarchy, efficient form layouts, and robust table/list components. Material Design 3 provides the necessary density controls and structured layouts for admin interfaces while maintaining visual clarity.

**Core Principles:**
- Information density over visual flourish
- Clear workflow progression through distinct sections
- Immediate feedback on all actions
- Scannable data tables and lists

---

## Typography System

**Font Family:** Roboto (primary), Roboto Mono (data/code)

**Hierarchy:**
- Page Title: 32px, Medium (500)
- Section Headers: 24px, Medium (500)
- Subsection/Card Titles: 18px, Medium (500)
- Body Text: 16px, Regular (400)
- Field Labels: 14px, Medium (500)
- Helper Text: 13px, Regular (400)
- Table Headers: 14px, Medium (500)
- Table Data: 14px, Regular (400)
- ECLI Codes: 14px, Roboto Mono, Regular

---

## Layout & Spacing System

**Spacing Scale:** Tailwind units: 2, 3, 4, 6, 8, 12, 16  
- Tight spacing (forms): p-3, gap-3
- Standard spacing (sections): p-6, gap-6
- Section separation: mb-8, mt-12
- Page margins: px-8, py-6

**Grid Structure:**
- Main container: max-w-7xl mx-auto
- Single column layout (no multi-column needed)
- Form fields: Full width in mobile, max-w-md in desktop
- Tables: Full container width with horizontal scroll

**Vertical Flow:**
- Header (fixed): h-16
- Main content: Scrollable area with distinct sections stacked vertically
- Each section contained in bordered cards with subtle elevation

---

## Component Library

### 1. Page Header
- Full-width bar with application title and status indicator
- Height: h-16
- Contains: App name (left), connection status badge (right)

### 2. Section Cards
Each workflow section wrapped in cards:
- Border: 1px solid boundary
- Padding: p-6
- Margin bottom: mb-8
- Rounded corners: rounded-lg
- Subtle shadow for depth

### 3. Filter Section (Rechtspraak Controls)
**Layout:** Vertical form layout
- **Date Range Inputs:** Two date pickers side-by-side (From/To)
- **Dropdown Filters:** Full-width selects for Document Type, Court, Legal Area
- **Numeric Input:** "Results per page" - max-w-32
- **Checkbox:** "Full documents only" with helper text below
- **Action Button:** Primary filled button, full-width on mobile, max-w-xs on desktop
- Spacing between fields: gap-4

### 4. ECLI List Display
**Table Structure:**
- Header row with columns: ECLI | Title | Court | Decision Date | Actions
- Monospace font for ECLI codes
- Rows with alternating subtle background
- Row height: h-12
- Sticky header when scrolling
- Action icons (view, select) aligned right

**Pagination Controls:**
- Below table: Centered
- Shows: "Showing X-Y of Z results"
- Buttons: Previous | Load More | Next
- Current page indicator

### 5. Record Preparation Section
**Two-part layout:**
- **Top:** Action button "Fetch Full Content" (outlined style)
- **Bottom:** Expandable/collapsible record cards

**Record Cards:**
- Each prepared record in accordion-style card
- Header shows: ECLI (bold) + Court + Date
- Expand to show: Full metadata + text preview (max 300 chars with "Show more")
- Checkbox for bulk selection
- Spacing: gap-3 between cards

### 6. Pinecone Export Panel
**Form Layout:**
- **Configuration Inputs:** 
  - Index Host (text input, full-width)
  - Namespace (text input with "(optional)" placeholder)
  - Batch Size (numeric input, max-w-32)
- **Helper Box:** Bordered info box explaining Secrets requirement
  - Icon: Info icon from Material Icons
  - Text: "Set PINECONE_API_KEY in Replit Secrets"
- **Action Button:** Primary filled, "Send to Pinecone"
- **Progress Log:** 
  - Scrollable text area, max-h-64
  - Monospace font
  - Shows batch progress, success/error counts
  - Auto-scrolls to bottom

### 7. Buttons
**Primary (Fetch/Send actions):**
- Filled style
- Height: h-11
- Padding: px-6
- Rounded: rounded-md
- Icon + text (Material Icons: search, upload, etc.)

**Secondary (Clear/Reset):**
- Outlined style
- Same dimensions as primary
- Positioned as needed per section

**States:** All buttons show loading spinner when active

### 8. Input Fields
**Text/Number Inputs:**
- Height: h-10
- Border: 1px solid
- Rounded: rounded-md
- Padding: px-3
- Focus: visible focus ring

**Select Dropdowns:**
- Match text input styling
- Icon: Material Icons chevron_down

**Date Pickers:**
- Native HTML5 date inputs
- Match text input styling

### 9. Status & Feedback
**Loading States:**
- Inline spinners for buttons
- Skeleton loaders for table rows
- Overlay with spinner for full-page operations

**Status Badges:**
- Small rounded badges: rounded-full, px-3, py-1
- For connection status, record counts
- Positioned top-right of relevant sections

**Error Messages:**
- Alert box style
- Red left border (border-l-4)
- Padding: p-4
- Shows above relevant sections

---

## Icons
**Library:** Material Icons (CDN)  
**Usage:**
- Search (filter section)
- Cloud_upload (Pinecone export)
- Info (helper text)
- Check_circle (success states)
- Error (error states)
- Expand_more/less (accordions)
- Refresh (reset actions)

---

## Information Architecture

**Section Order (Top to Bottom):**
1. **Page Header** - App title + status
2. **Rechtspraak Filter & Fetch** - Card with form + fetch button
3. **ECLI Results** - Card with table + pagination
4. **Record Preparation** - Card with fetch button + expandable records
5. **Pinecone Export** - Card with config form + log output

**Visual Separation:** Each section clearly bounded by cards with consistent spacing (mb-8)

---

## Accessibility
- All form inputs have visible labels (not just placeholders)
- Focus indicators on all interactive elements
- ARIA labels for icon buttons
- Status messages announced to screen readers
- Keyboard navigation for all workflows
- Sufficient contrast ratios throughout

---

## Responsive Behavior
- **Mobile (< 768px):** Single column, full-width inputs, stacked filters
- **Tablet (768-1024px):** Some filters in 2-column grid, tables scroll horizontally
- **Desktop (> 1024px):** Optimal layout with max-w-7xl container

This design prioritizes workflow efficiency and data clarity over visual embellishment, perfect for a specialized ingestion tool used by legal/technical professionals.