// Systems binds the rendition effect; Data admits the fixed edition profile.
import {fabricateEbookEdition as fabricate} from '@red-cup-engineering/ebook-engineering-services-section/fabricate-ebook-edition';
import {produceEbook} from '../scripts/produce-ebook.mjs';
export {produceEbook};
export {produceSetOfEbooks} from '../scripts/produce-set-of-ebooks.mjs';
export function fabricateEbookEdition(specification, source) {
 return fabricate(specification, source, {renderer: produceEbook});
}
