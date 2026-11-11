// What publications.js makes of some DOIs and dates (issue #127), shared by
// the server's copy (publications.test.js) and the client's
// (client/src/landing/publications.test.js), so the two can't drift apart.
// Node builtins only, so the client's tests can import it.

// [text, isDoi, doiUrl]
export const DOI_CASES = [
  ['10.1234/abcd', true, 'https://doi.org/10.1234/abcd'],
  ['10.1038/s41586-020-2649-2', true, 'https://doi.org/10.1038/s41586-020-2649-2'],
  ['10.1000.10/123456', true, 'https://doi.org/10.1000.10/123456'],
  ['10.123456789/x', true, 'https://doi.org/10.123456789/x'],
  ['10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0', true, 'https://doi.org/10.1002/(SICI)1097-4571(199806)49:8%3C693::AID-ASI4%3E3.0.CO;2-0'],
  ['10.1234/a#b?c%d', true, 'https://doi.org/10.1234/a%23b%3Fc%25d'],
  ['10.1234/a/b/c', true, 'https://doi.org/10.1234/a/b/c'],
  [' 10.1234/abcd ', true, 'https://doi.org/10.1234/abcd'],
  // Typed so far: saves as text, but isn't a link yet.
  ['', false, ''],
  ['1', false, ''],
  ['10', false, ''],
  ['10.', false, ''],
  ['10.12', false, ''],
  ['10.1234', false, ''],
  ['10.1234.', false, ''],
  ['10.1234.5', false, ''],
  ['10.1234/', false, ''],
  // Never a DOI.
  ['https://doi.org/10.1234/abcd', false, ''],
  ['doi:10.1234/abcd', false, ''],
  ['11.1234/abcd', false, ''],
  ['10.123/abcd', false, ''],
  ['10.1234567890/abcd', false, ''],
  ['10.1.5', false, ''],
  ['10.abcd/efgh', false, ''],
  ['10.1234/ab cd', false, ''],
  ['javascript:alert(1)', false, ''],
  [null, false, ''],
  [1234, false, ''],
];

// [pasted, what the editor's field keeps]
export const CLEAN_DOI_CASES = [
  ['https://doi.org/10.1234/abcd', '10.1234/abcd'],
  ['http://dx.doi.org/10.1234/abcd', '10.1234/abcd'],
  ['HTTPS://DOI.ORG/10.1234/abcd', '10.1234/abcd'],
  ['doi.org/10.1234/abcd', '10.1234/abcd'],
  ['doi:10.1234/abcd', '10.1234/abcd'],
  ['DOI: 10.1234/abcd', '10.1234/abcd'],
  ['https://www.doi.org/10.1234/abcd', '10.1234/abcd'],
  ['DOI 10.1234/abcd', '10.1234/abcd'],
  ['doi', 'doi'],
  // A link from the address bar, %-escaped: decoded, so doiUrl() doesn't
  // encode it twice.
  ['https://doi.org/10.1002/(SICI)1097-4571(199806)49:8%3C693::AID-ASI4%3E3.0.CO;2-0', '10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0'],
  ['https://doi.org/10.1234/a%zz', '10.1234/a%zz'],
  ['10.1234/abcd', '10.1234/abcd'],
  ['https://example.org/10.1234/abcd', 'https://example.org/10.1234/abcd'],
  ['', ''],
];

// [dates in the draft's order, the order newestFirst() gives them in] (by
// index into the first list)
export const NEWEST_CASES = [
  [['2019', '2024', '2021'], [1, 2, 0]],
  // Every way readDate() reads, mixed.
  [['Mar 2021', '2023-06-01', '05/2022', 'December 2021', '2020-11'], [1, 2, 3, 0, 4]],
  // A year alone after that year's months, a month after its days.
  [['2024', 'Jan 2024', '2024-01-15', '2023'], [2, 1, 0, 3]],
  // Unreadable dates keep their places; the readable ones fill the rest.
  [['2019', 'Forthcoming', '2024', 'Spring 2022', '2021'], [2, 1, 4, 3, 0]],
  [['In press', '2018', '', '2020'], [0, 3, 2, 1]],
  [['Forthcoming', 'n.d.'], [0, 1]],
  // Equal dates keep their order.
  [['2022', 'Feb 2023', '2022', '2023-02', '2022'], [1, 3, 0, 2, 4]],
  [[], []],
];
