<script setup lang="ts">
import { parse as yamlParser } from 'yaml';

definePage(() => {
  const yml = `
style:
  navigationBarTitleText: "yaml test"
`;
  return yamlParser(yml);
});

// other codes ....
</script>

<template>
  yaml test
</template>
