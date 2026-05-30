---
name: PraktiQU Design System
colors:
  surface: '#fcf8ff'
  surface-dim: '#dcd8e5'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2ff'
  surface-container: '#f0ecf9'
  surface-container-high: '#eae6f4'
  surface-container-highest: '#e4e1ee'
  on-surface: '#1b1b24'
  on-surface-variant: '#464555'
  inverse-surface: '#302f39'
  inverse-on-surface: '#f3effc'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4e44e3'
  primary: '#3625cd'
  on-primary: '#ffffff'
  primary-container: '#5046e5'
  on-primary-container: '#dbd8ff'
  inverse-primary: '#c3c0ff'
  secondary: '#4953bc'
  on-secondary: '#ffffff'
  secondary-container: '#8792fe'
  on-secondary-container: '#17228f'
  tertiary: '#7e3000'
  on-tertiary: '#ffffff'
  tertiary-container: '#a54100'
  on-tertiary-container: '#ffd2c0'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3422cc'
  secondary-fixed: '#e0e0ff'
  secondary-fixed-dim: '#bdc2ff'
  on-secondary-fixed: '#000767'
  on-secondary-fixed-variant: '#2f3aa3'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb695'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7b2f00'
  background: '#fcf8ff'
  on-background: '#1b1b24'
  surface-variant: '#e4e1ee'
typography:
  display:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-semibold:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  small:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  h1-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 24px
  margin: 24px
---

## Brand & Style
The design system is engineered for high-efficiency clinical environments. It prioritizes clarity, trust, and speed of use, ensuring that healthcare providers can manage patient data and clinic operations without cognitive overload. 

The visual style is **Corporate / Modern** with a clinical focus. It utilizes a structured layout, a neutral-leaning palette punctuated by purposeful color, and an emphasis on legibility. The aesthetic is "Professional Clean," avoiding decorative flourishes in favor of utility and a sense of calm reliability.

## Colors
The palette is rooted in a professional Indigo primary, conveying authority and technology. 
- **Primary & Primary Light:** Used for active states, primary actions, and branding accents.
- **Surface & Background:** A crisp white surface sits atop a cool-toned Slate background to create subtle depth without relying on heavy shadows.
- **Functional Colors:** Success, Warning, and Error colors are used strictly for status indicators (e.g., appointment status, overdue payments, or medical alerts) to ensure they retain their communicative power.

## Typography
The design system utilizes **Inter** exclusively to leverage its exceptional legibility in data-heavy interfaces. 
- **Display and Headlines:** Use tighter letter spacing and heavier weights to establish a clear hierarchy on dashboard overviews.
- **Body Text:** Set at 14px for a balance between information density and readability, essential for patient records.
- **Labels:** Used for table headers and form captions, often employing uppercase or semi-bold weights to differentiate from user-inputted data.

## Layout & Spacing
The layout follows a **Fixed Grid** model for the main dashboard content to ensure data tables and charts maintain optimal line lengths.
- **Grid:** A 12-column system is used for desktop (breakpoints at 1440px).
- **Rhythm:** An 8px linear scale (base 4px) governs all padding and margins. 
- **Sidebar:** A fixed 260px sidebar is used for primary navigation, while the main content area utilizes a fluid-width container with a maximum width of 1200px for readability.
- **Mobile:** Reflows to a single column with 16px horizontal margins.

## Elevation & Depth
Depth is communicated through **Tonal Layers** and **Ambient Shadows**.
- **Level 0 (Background):** #F8FAFC — The foundation layer.
- **Level 1 (Surface):** #FFFFFF — Main content cards and navigation bars.
- **Shadows:** Use a very soft, diffused shadow for elevated elements: `0px 1px 3px rgba(0, 0, 0, 0.1), 0px 1px 2px rgba(0, 0, 0, 0.06)`. 
- **Interactivity:** On hover, cards may increase their shadow slightly or add a 1px border using `Primary Light` to indicate focus.

## Shapes
The design system uses a consistent **Rounded** (8px / 0.5rem) corner radius. This softens the technical nature of a dashboard, making the clinic environment feel more approachable and modern.
- **Buttons and Inputs:** 8px radius.
- **Cards and Modals:** 12px (rounded-lg) to provide a distinct container feel.
- **Status Badges:** Fully rounded (pill-shaped) to distinguish them from interactive buttons.

## Components
- **Buttons:** Primary buttons use a solid #5046E5 background with white text. Secondary buttons use a subtle gray stroke with text in #1E293B. All buttons feature 8px rounded corners and a height of 40px for standard actions.
- **Input Fields:** Default state features a 1px border in #E2E8F0. Focus state transitions the border to #818CF8 with a subtle outer glow. Labels are positioned above the field in `Small` bold typography.
- **Cards:** Used to group patient data or analytics. They feature a white surface, 12px corner radius, and a subtle ambient shadow. Headlines within cards use `H2` styling.
- **Chips/Badges:** Small, pill-shaped indicators for status (e.g., "Confirmed," "Cancelled"). Use a 10% opacity background of the functional color with 100% opacity text for high legibility (e.g., Success text on light green background).
- **Data Tables:** Clean rows with 1px border-bottom in #F1F5F9. Header row uses #F8FAFC background and `Label` typography.
- **Clinic-Specific Components:** 
    - **Appointment Slots:** Interactive grid blocks with color coding for availability.
    - **Patient Profile Header:** A condensed summary component containing the patient's name, ID, and primary allergy alerts.