import {TagRepository} from "./foundry/repository.js";
import {TagService} from "./foundry/service.js";

export const tagRepository = new TagRepository();
export const tagService = new TagService(tagRepository);
