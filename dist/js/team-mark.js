const marks = {
  'gosh.svg': 'gosh-mark.svg',
  '100_thieves.svg': '100_thieves.svg#_100_THIEVES',
};

export function teamMark(logo) {
  return '/assets/' + (marks[logo] ?? logo);
}
