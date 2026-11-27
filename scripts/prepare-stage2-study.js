import { readFile, rename, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import stage1 from '../dist/data/stage.json' with { type: 'json' };
import invitations from '../dist/data/stage2-invites.json' with { type: 'json' };
import installed from '../dist/data/study-s2.js';
import { pglTeamId } from '../server/agenda.js';

const stageId = 'sg26-s2-v1';
const scheduleUrl = 'https://news.pglesports.com/api/groupStageEndpoint?stage=2';
const pool = [
  ...invitations.teams.map(team => ({ ...team, entry: 'invited' })),
  ...stage1.teams.map(({ name, logo, vrs }) => ({
    id: logo.split('.')[0], name, vrs, entry: 'stage1',
  })),
];

export function validateStage2Study(study, schedule) {
  const opening = schedule.filter(match => /^opening round\b/i.test(match.round));
  const ids = opening.flatMap(match => [pglTeamId(match.leftTeamKey), pglTeamId(match.rightTeamKey)]);
  const field = new Set(ids);
  if (opening.length !== 8 || field.size !== 16 ||
      !ids.every(id => pool.some(team => team.id === id)) ||
      !invitations.teams.every(team => field.has(team.id)))
    throw Error('A PGL precisa confirmar os oito confrontos de abertura do Stage 2.');
  const starts = opening.map(({ date, time, timeZone }) => {
    if (timeZone !== 'SGT' || !/^\d{2}\.\d{2}\.2026$/.test(date)) return NaN;
    return Date.parse(date.split('.').reverse().join('-') + 'T' + time + ':00+08:00');
  });
  const deadline = Math.min(...starts) - 3600000;
  if (!Number.isFinite(deadline)) throw Error('Horário de abertura inválido na agenda PGL.');
  if (study.stage !== stageId || typeof study.version !== 'string' || !study.version.trim())
    throw Error('Informe a fase sg26-s2-v1 e a versão do estudo.');
  if (study.sourceUrl !== undefined && new URL(study.sourceUrl).protocol !== 'https:')
    throw Error('O endereço do estudo publicado deve usar HTTPS.');
  if (typeof study.cutoff !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(study.cutoff) ||
      !Number.isFinite(Date.parse(study.cutoff)) || Date.parse(study.cutoff) > deadline)
    throw Error('O corte dos dados deve ter fuso horário e anteceder ou coincidir com o fechamento.');
  const teamIds = Array.isArray(study.teamIds) ? study.teamIds.map(pglTeamId) : [];
  if (teamIds.length !== 16 || new Set(teamIds).size !== 16 || !teamIds.every(id => field.has(id)))
    throw Error('As 16 chaves de equipe do estudo precisam coincidir com as da PGL.');
  for (const bo of [1, 3]) {
    const matrix = study.probabilities?.[bo];
    if (!Array.isArray(matrix) || matrix.length !== 16 ||
        !matrix.every(row => Array.isArray(row) && row.length === 16))
      throw Error('Matriz MD' + bo + ' incompleta.');
    matrix.forEach((row, a) => row.forEach((value, b) => {
      if (!Number.isFinite(value) || value < 0 || value > 1 ||
          (a === b && value !== 0.5) || Math.abs(value + matrix[b][a] - 1) > 1e-9)
        throw Error('Probabilidade inválida em MD' + bo + ': ' + study.teamIds[a] + ' × ' + study.teamIds[b]);
    }));
  }
  return {
    stage: stageId, version: study.version, cutoff: study.cutoff,
    ...(study.sourceUrl ? { sourceUrl: study.sourceUrl } : {}),
    teamIds, probabilities: { 1: study.probabilities[1], 3: study.probabilities[3] },
  };
}

async function main([action, input, fixture]) {
  if (action === '--pool') {
    console.log(JSON.stringify({ stage: stageId, sources: invitations.sources, candidates: pool }, null, 2));
    return;
  }
  if (!['--check', '--install'].includes(action) || !input)
    throw Error('Use --pool, --check estudo.json [agenda-pgl.json] ou --install estudo.json.');
  if (fixture && action === '--install') throw Error('A instalação confere o elenco diretamente na PGL.');
  const study = JSON.parse(await readFile(input, 'utf8'));
  let schedule;
  if (fixture) schedule = JSON.parse(await readFile(fixture, 'utf8'));
  else {
    const response = await fetch(scheduleUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('PGL HTTP ' + response.status);
    schedule = await response.json();
  }
  const validated = validateStage2Study(study, schedule);
  if (action === '--install') {
    if (installed && JSON.stringify(installed) !== JSON.stringify(validated))
      throw Error('Já existe uma edição congelada. Preserve-a ao publicar outra versão.');
    if (!installed) {
      const destination = new URL('../dist/data/study-s2.js', import.meta.url);
      const temporary = new URL('study-s2-' + randomUUID() + '.tmp', destination);
      try {
        await writeFile(temporary, 'export default ' + JSON.stringify(validated) + ';\n', { flag: 'wx' });
        await rename(temporary, destination);
      } finally { await rm(temporary, { force: true }); }
    }
  }
  console.log(validated.version + ' · 16 equipes · 120 confrontos em MD1 e MD3 · ' + action.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
