import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().optional(),
    date: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    excerpt: z.string().default(''),
    repo: z.string().url().optional(),
    demo: z.string().url().optional(),
  }),
});

export const collections = { posts };