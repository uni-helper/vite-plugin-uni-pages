<script lang="ts" setup>
import { currentUniPlatform, UniPlatform } from '@uni-helper/vite-plugin-uni-pages';


definePage(() => {
    let title = 'hello world';


    // 条件编译
    if (currentUniPlatform(UniPlatform.MpAlipay)) {
        title += ': MP Alipay';
    }

    return {
        style: {
            navigationBarTitleText: title,
        },
        middlewares: [
            'auth',
        ],
    };
});
</script>

<template>
    <div>define page in function mode</div>
</template>
