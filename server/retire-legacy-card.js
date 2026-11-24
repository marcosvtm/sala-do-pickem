import { CLOSE } from './results.js';

// Release-scoped data correction authorized by the Site owner. All identifiers
// are fixed here. The two retained entries must still be present in this stage.
export function retireLegacyCard(db) {
  return db.prepare(`
    UPDATE cards
       SET removed_at=unixepoch(), nick='', nick_key='!'||id,
           settings='{}', revision=revision+1
     WHERE stage='sg26-s1-v1' AND id='0ed2dd40-eba2-47c9-be25-561c1dfbc379'
       AND nick='mrk' COLLATE BINARY AND submitted=1795395844 AND revision=1
       AND removed_at IS NULL AND edit_hash IS NULL AND unixepoch() < ?
       AND EXISTS (SELECT 1 FROM cards AS keep
                    WHERE keep.stage=cards.stage AND keep.nick='mr.K' COLLATE BINARY
                      AND keep.id='0c00d9cd-c9a3-4e2e-9cca-a4385d276a74'
                      AND keep.submitted=1795481241 AND keep.removed_at IS NULL)
       AND EXISTS (SELECT 1 FROM personal_models AS keep
                    WHERE keep.stage=cards.stage AND keep.nick='mr.K' COLLATE BINARY
                      AND keep.id='fdd004b1-a6b5-45e0-99ca-05596961a831'
                      AND keep.submitted=1795481121)
  `).bind(CLOSE / 1000).run();
}
