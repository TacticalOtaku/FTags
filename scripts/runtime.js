import {TagRepository} from "./core/repository.js";
import {TagService} from "./core/service.js";

export const tagRepository = new TagRepository();
export const tagService = new TagService(tagRepository);
