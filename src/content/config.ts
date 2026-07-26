import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.date(),
    tags: z.array(z.string()),
    excerpt: z.string(),
    repo: z.string().url().optional(),
    demo: z.string().url().optional(),
  }),
});

export const collections = { posts };
