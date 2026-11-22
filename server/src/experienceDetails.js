// The labelled details an experience entry may carry for a US federal
// (USAJOBS) or other formal resume (issue #223). They're public facts of
// the resume, never AI context: no AI builder copies them (each reads
// named fields), and publicBlocks.js drops them from a surface their
// detailsVisibleWeb / detailsVisiblePrint flag hides them on.
// client/src/resume/experienceDetails.js mirrors the list; its test
// compares the two.
export const EXPERIENCE_DETAIL_KEYS = ['hoursPerWeek', 'grade', 'salary', 'supervisor', 'contactSupervisor'];
