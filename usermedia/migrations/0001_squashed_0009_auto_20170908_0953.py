# Generated by Django 1.11.13 on 2018-08-14 17:37
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import usermedia.models


class Migration(migrations.Migration):

    replaces = [('usermedia', '0001_initial'), ('usermedia', '0002_auto_20151226_1110'), ('usermedia', '0003_auto_20160218_2222'), ('usermedia', '0004_auto_20160218_2250'), ('usermedia', '0005_userimage'), ('usermedia', '0006_auto_20170813_2154'), ('usermedia', '0007_auto_20170813_2206'), ('usermedia', '0008_documentimage'), ('usermedia', '0009_auto_20170908_0953')]

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('document', '0030_document_bibliography'),
    ]

    operations = [
        migrations.CreateModel(
            name='Image',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=128)),
                ('added', models.DateTimeField(auto_now_add=True)),
                ('image', models.FileField(upload_to=usermedia.models.get_file_path)),
                ('thumbnail', models.ImageField(blank=True, max_length=500, null=True, upload_to='image_thumbnails')),
                ('image_cat', models.CharField(default='', max_length=255)),
                ('file_type', models.CharField(blank=True, max_length=20, null=True)),
                ('height', models.IntegerField(blank=True, null=True)),
                ('width', models.IntegerField(blank=True, null=True)),
                ('checksum', models.BigIntegerField(default=0)),
                ('uploader', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='uploader', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='ImageCategory',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('category_title', models.CharField(max_length=100)),
                ('category_owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name_plural': 'Image categories',
            },
        ),
        migrations.AddField(
            model_name='image',
            name='owner',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='image_owner', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='image',
            name='uploader',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='image_uploader', to=settings.AUTH_USER_MODEL),
        ),
        migrations.CreateModel(
            name='UserImage',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=128)),
                ('image_cat', models.CharField(default='', max_length=255)),
                ('image', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='usermedia.Image')),
                ('owner', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='image_owner', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.RemoveField(
            model_name='image',
            name='image_cat',
        ),
        migrations.RemoveField(
            model_name='image',
            name='owner',
        ),
        migrations.RemoveField(
            model_name='image',
            name='title',
        ),
        migrations.CreateModel(
            name='DocumentImage',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(default='', max_length=128)),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='document.Document')),
                ('image', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='usermedia.Image')),
            ],
        ),
    ]