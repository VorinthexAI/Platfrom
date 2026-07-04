import { enrich } from './enrich';
import { embed } from './embed';
import { ai_generate } from './ai_generate';
import { ai_search } from './ai_search';
import { council } from './council';
import { research } from './research';
import { get_model } from './get_model';
import { generate_images } from './generate_images';
import { fetch_s3_context } from './fetch_s3_context';
import { write_s3_context } from './write_s3_context';
import { get_post_schema } from './get_post_schema';
import { write_post } from './write_post';
import { render_slideshow } from './render_slideshow';
import { render_post } from './render-post';
import { save_output } from './save_output';
import { search_output } from './search_output';
import { validate_against_mission } from './validate_against_mission';

export const ACTION_HANDLERS = {
  ACTION_ENRICH: enrich,
  ACTION_EMBED: embed,
  ACTION_AI_GENERATE: ai_generate,
  ACTION_AI_SEARCH: ai_search,
  ACTION_COUNCIL: council,
  ACTION_RESEARCH: research,
  ACTION_GET_MODEL: get_model,
  ACTION_GENERATE_IMAGES: generate_images,
  ACTION_FETCH_S3_CONTEXT: fetch_s3_context,
  ACTION_WRITE_S3_CONTEXT: write_s3_context,
  ACTION_GET_POST_SCHEMA: get_post_schema,
  ACTION_WRITE_POST: write_post,
  ACTION_RENDER_SLIDESHOW: render_slideshow,
  ACTION_RENDER_POST: render_post,
  ACTION_SAVE_OUTPUT: save_output,
  ACTION_SEARCH_OUTPUT: search_output,
  ACTION_VALIDATE_AGAINST_MISSION: validate_against_mission,
} as const;

export type ActionSlug = keyof typeof ACTION_HANDLERS;

